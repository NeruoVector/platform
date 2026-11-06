import { chromium } from '../../../monitoring/node_modules/playwright-core/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import assert from 'node:assert/strict'

const output = fileURLToPath(new URL('.', import.meta.url))
const plan = JSON.parse(await readFile(output+'cuts.json','utf8'))
const browser = await chromium.launch({ executablePath:homedir()+'/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files'] })
const context = await browser.newContext({ viewport:{width:1440,height:1000} })
const page = await context.newPage()
const result={ duration:0, width:0, height:0, playback:false, endReached:false, captions:0, frameCaptures:0, responsive:[] }
try {
  await page.goto(pathToFileURL(output+'index.html').href)
  await page.locator('video').evaluate(v=>new Promise(resolve=>{if(v.readyState>=1)resolve();else v.addEventListener('loadedmetadata',resolve,{once:true})}))
  const media=await page.locator('video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight}))
  assert.equal(media.duration,plan.duration);assert.equal(media.width,1920);assert.equal(media.height,1080)
  Object.assign(result,media)
  for(const width of [390,1440]) {
    await page.setViewportSize({width,height:1000})
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)
    assert.equal(overflow,false)
    result.responsive.push({width,overflow})
    await page.screenshot({path:output+'qa/player-'+width+'.png',fullPage:true})
  }
  await page.locator('video').focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v.currentTime>0.5&&!v.paused},{timeout:15000})
  result.playback=true
  await page.locator('video').evaluate(v=>{v.playbackRate=4})
  await page.waitForFunction(()=>document.querySelector('video').ended,{timeout:45000})
  result.endReached=true
  await page.locator('video').evaluate(async v=>{
    const t=document.createElement('track');t.kind='metadata';t.src='demo-ko.vtt';v.append(t);t.track.mode='hidden'
    await new Promise((resolve,reject)=>{t.addEventListener('load',resolve,{once:true});t.addEventListener('error',()=>reject(new Error('VTT failed')), {once:true})})
  })
  const cues=await page.locator('video').evaluate(v=>Array.from(v.textTracks[0].cues).map(c=>({start:c.startTime,end:c.endTime,text:c.text})))
  assert.equal(cues.length,plan.cuts.length)
  for(let i=0;i<cues.length;i++){assert.equal(cues[i].start,plan.cuts[i].at);assert.equal(cues[i].end,plan.cuts[i].end)}
  result.captions=cues.length
  await writeFile(output+'qa/frame.html','<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#faf7f2}video{display:block;width:1920px;height:1080px}</style><video muted preload="auto" src="../demo-ko.mp4"></video>')
  await page.setViewportSize({width:1920,height:1080})
  await page.goto(pathToFileURL(output+'qa/frame.html').href)
  for(const c of plan.cuts) {
    await page.locator('video').evaluate(async(v,time)=>{
      if(v.readyState<1)await new Promise(resolve=>v.addEventListener('loadedmetadata',resolve,{once:true}))
      await new Promise(resolve=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=time})
    },c.at+c.seconds/2)
    await page.screenshot({path:output+'qa/final-'+c.id+'.png'})
    result.frameCaptures++
  }
  const sheet='<!doctype html><meta charset="utf-8"><style>body{margin:0;display:grid;grid-template-columns:repeat(3,480px);background:#eee;font:18px sans-serif}figure{margin:0}figcaption{height:30px;padding:3px 10px}img{display:block;width:480px;height:270px}</style>'+plan.cuts.map(c=>`<figure><figcaption>${c.at}s · ${c.heading.replaceAll('\n',' ')}</figcaption><img src="final-${c.id}.png"></figure>`).join('')
  await writeFile(output+'qa/contact-sheet.html',sheet)
  await page.setViewportSize({width:1440,height:1500})
  await page.goto(pathToFileURL(output+'qa/contact-sheet.html').href)
  await page.screenshot({path:output+'qa/contact-sheet.png',fullPage:true})
  await writeFile(output+'qa/final-playwright.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
} finally { await context.close();await browser.close() }
