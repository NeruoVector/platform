import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { timeline } from './timeline.mjs'

const output = fileURLToPath(new URL('.', import.meta.url))
const source = fileURLToPath(new URL('../raw', import.meta.url))
const image = 'sha256:0ae09ee959d203bd0c13699c9cdf78dc7ffc0957cde146a4c43f90ce9bf081e1'
const common = ['run','--rm','--network','none','--cpus','2','--memory','1g','--user',`${process.getuid()}:${process.getgid()}`,'--read-only','--tmpfs','/tmp:rw,size=64m','--entrypoint','/usr/bin/ffmpeg','-v',`${source}:/source:ro`,'-v',`${output}:/out:rw`,image,'-hide_banner','-nostdin','-y','-filter_complex_threads','1','-filter_threads','1']
const codec = ['-an','-c:v','libx264','-preset','veryfast','-crf','19','-threads','2','-r','25','-pix_fmt','yuv420p','-video_track_timescale','12800','-movflags','+faststart']
await mkdir(output+'segments',{recursive:true})
const rendered = JSON.parse(await readFile(output+'cuts.json','utf8'))
const selected = process.argv.slice(2)
for (const clip of rendered.cuts.filter(c => selected.length === 0 || selected.includes(c.id))) {
  const args = [...common]
  if (clip.source) {
    const input = clip.kind === 'admin' ? '/out/assets/admin-source.webm' : '/source/'+clip.source
    const c=clip.crop
    const width=Math.round(c.w*c.scale/2)*2, height=Math.round(c.h*c.scale/2)*2
    const filter=`[0:v]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${width}:${height}:flags=lanczos,fps=25,setsar=1,setpts=PTS-STARTPTS[footage];[1:v]fps=25,format=yuv420p[board];[board][footage]overlay=${c.left}:${c.top}:shortest=1:format=auto,format=yuv420p[v]`
    args.push('-ss',String(clip.start),'-threads','2','-i',input,'-loop','1','-framerate','25','-threads','1','-i','/out/assets/'+clip.id+'.png','-filter_complex',filter,'-map','[v]')
  } else args.push('-loop','1','-framerate','25','-threads','1','-i','/out/assets/'+clip.id+'.png')
  args.push('-t',String(clip.seconds),...codec,'/out/segments/'+clip.id+'.mp4')
  const log=createWriteStream(output+'qa/encode-'+clip.id+'.log')
  const child=spawn('docker',args,{stdio:['ignore','ignore','pipe']})
  child.stderr.pipe(log)
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
  log.end()
  if(code!==0) throw new Error('Encoding failed for '+clip.id+'; see its encode log')
  console.log('Encoded',clip.id,clip.seconds+'s')
}
await writeFile(output+'segments/concat.txt',timeline.map(c=>`file '${c.id}.mp4'`).join('\n')+'\n')
const log=createWriteStream(output+'qa/concat.log')
const child=spawn('docker',[...common,'-f','concat','-safe','0','-i','/out/segments/concat.txt','-c','copy','-movflags','+faststart','/out/demo-ko.mp4'],{stdio:['ignore','ignore','pipe']})
child.stderr.pipe(log)
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
log.end()
if(code!==0) throw new Error('Concatenation failed; see concat.log')
console.log('Exported demo-ko.mp4')
