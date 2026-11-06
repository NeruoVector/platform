import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))
const source = fileURLToPath(new URL('..', import.meta.url))
const font = '/home/helloworld0822/.local/share/fonts/nv-qa/NotoSansKR-VF.ttf'
const timeline = [
  { id: 'intro', duration: 4, kind: 'card', section: 'NEUROVECTOR', title: '교내 배달 기능 시연', caption: '상품 선택부터 운영 관리와 드론 모니터링까지', detail: '실제 서비스 화면으로 살펴봅니다.' },
  { id: 'home', duration: 5, kind: 'phone', file: '01-customer-app.mp4', start: 1.6, crop: '360:228:908:454', section: '01  사용자 앱', title: '사진과 가격으로 상품을 고릅니다', caption: '상품 사진과 가격을 비교하고', detail: '원하는 간식을 선택합니다.' },
  { id: 'category', duration: 5, kind: 'phone', file: '01-customer-app.mp4', start: 7.3, crop: '360:228:908:306', section: '01  사용자 앱', title: '카테고리로 빠르게 탐색합니다', caption: '음료·젤리 등 카테고리를 선택해', detail: '보고 싶은 상품만 모아봅니다.' },
  { id: 'options', duration: 8, kind: 'phone', file: '01-customer-app.mp4', start: 15.8, crop: '360:228:908:638', section: '01  사용자 앱', title: '옵션과 수량을 직접 선택합니다', caption: '상품 상세에서 봉투 포함 여부와', detail: '주문 수량을 선택합니다.' },
  { id: 'cart', duration: 7, kind: 'phone', file: '01-customer-app.mp4', start: 24.7, crop: '360:228:908:530', section: '01  사용자 앱', title: '장바구니에서 주문을 확인합니다', caption: '상품 금액과 배달비를 확인하고', detail: '매장에 전달할 요청사항을 입력합니다.' },
  { id: 'payment', duration: 6, kind: 'phone', file: '01-customer-app.mp4', start: 31.8, crop: '360:228:908:240', section: '01  사용자 앱', title: '주문 정보와 받을 장소를 확인합니다', caption: '주문 내역과 받을 장소를 살펴봅니다.', detail: '실제 청구가 없는 테스트 결제 안내 화면입니다.' },
  { id: 'place', duration: 5, kind: 'phone', file: '01-customer-app.mp4', start: 39, crop: '360:228:908:522', section: '01  사용자 앱', title: '학교 안의 수령 장소를 고릅니다', caption: '현관·체육관 앞·본관 후문 중', detail: '상품을 받을 장소를 선택할 수 있습니다.' },
  { id: 'campus', duration: 7, kind: 'wide', file: '02-campus-monitor.mp4', start: 1.6, crop: '1130:670:395:296', size: '1316:780', section: '02  드론 모니터링', title: '학교 전체를 3D 지도로 확인합니다', caption: '학교 모델과 수신된 기체 위치를', detail: '하나의 지도에서 살펴봅니다.' },
  { id: 'topview', duration: 6, kind: 'wide', file: '02-campus-monitor.mp4', start: 9.6, crop: '1130:670:395:296', size: '1316:780', section: '02  드론 모니터링', title: '탑뷰로 공간과 위치를 파악합니다', caption: '위에서 보기로 전환하면', detail: '건물 배치와 기체 위치를 함께 볼 수 있습니다.' },
  { id: 'rotate', duration: 7, kind: 'wide', file: '02-campus-monitor.mp4', start: 25, crop: '1130:670:395:296', size: '1316:780', section: '02  드론 모니터링', title: '지도를 회전해 주변을 살펴봅니다', caption: '드래그로 지도를 회전하며', detail: '학교와 주변 공간을 여러 방향에서 확인합니다.' },
  { id: 'locate', duration: 7, kind: 'wide', file: '02-campus-monitor.mp4', start: 43, crop: '1130:670:395:296', size: '1316:780', section: '02  드론 모니터링', title: '기체 찾기로 위치를 확대합니다', caption: '기체 찾기 기능으로 시점을 옮겨', detail: '드론이 표시된 위치를 가까이 확인합니다.' },
  { id: 'detections', duration: 6, kind: 'wide', file: '02-campus-monitor.mp4', start: 68.6, crop: '1180:600:370:140', size: '1534:780', section: '02  드론 모니터링', title: '장애물 감지 이력을 확인합니다', caption: '감지한 객체와 신뢰도, 위험 단계를', detail: '시간순으로 살펴볼 수 있습니다.' },
  { id: 'inventory', duration: 6, kind: 'wide', file: '03-admin-products.mp4', start: 1, crop: '1640:770:248:200', size: '1660:780', section: '03  관리자', title: '상품과 재고를 한눈에 관리합니다', caption: '판매 중인 상품의 가격과 재고,', detail: '판매 상태를 한 화면에서 확인합니다.' },
  { id: 'search', duration: 5, kind: 'wide', file: '03-admin-products.mp4', start: 8.8, crop: '1440:676:248:190', size: '1660:780', section: '03  관리자', title: '상품명으로 필요한 상품을 찾습니다', caption: '검색어를 입력해 목록을 좁히고', detail: '관리할 상품의 수정 화면을 엽니다.' },
  { id: 'edit', duration: 7, kind: 'wide', file: '03-admin-products.mp4', start: 15, crop: '1040:540:248:222', size: '1502:780', section: '03  관리자', title: '상품 정보를 수정하는 화면입니다', caption: '상품명·판매가·재고·설명 등', detail: '기본 정보를 관리하는 화면을 살펴봅니다.' },
  { id: 'drone-status', duration: 6, kind: 'wide', file: '03-admin-products.mp4', start: 22.8, crop: '1640:770:248:180', size: '1660:780', section: '03  관리자', title: '드론 운용 상태를 확인합니다', caption: '기체 목록과 연결 상태를 확인하며', detail: '운영에 필요한 정보를 함께 살펴봅니다.' },
  { id: 'outro', duration: 4, kind: 'card', section: 'NEUROVECTOR', title: '주문 · 운영 · 드론 모니터링', caption: '하나의 서비스에서 살펴보는 교내 배달 흐름', detail: '사용자 앱  /  관리자  /  학교 3D 지도' },
]
const docker = ['run', '--rm', '--network', 'none', '--cpus', '1', '--memory', '768m', '--user', `${process.getuid()}:${process.getgid()}`, '--read-only', '--tmpfs', '/tmp:rw,size=32m', '-v', `${source}:/source:ro`, '-v', `${directory}:/out`, '-v', `${font}:/font.ttf:ro`, '--entrypoint', '/usr/bin/ffmpeg', 'neurovector-sim:local', '-hide_banner', '-nostdin', '-nostats', '-y', '-filter_complex_threads', '1', '-filter_threads', '1']
const codec = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '1', '-pix_fmt', 'yuv420p', '-r', '30', '-video_track_timescale', '15360', '-movflags', '+faststart']
const ink = '0x202226'
const drawText = (path, position, style) => `drawtext=fontfile=/font.ttf:textfile=/out/text/${path}:expansion=none:${position}:fontsize=${style.size}:fontcolor=${style.color ?? ink}:borderw=${style.border ?? 1}:bordercolor=${style.color ?? ink}`
await mkdir(directory + 'qa', { recursive: true })
let cursor = 0
const subtitles = []

for (const [index, scene] of timeline.entries()) {
  for (const [name, content] of Object.entries({ section: scene.section, title: scene.title, caption: scene.caption, detail: scene.detail, brand: 'NEUROVECTOR  /  서비스 시연', count: String(index + 1).padStart(2, '0') + ' / ' + timeline.length })) {
    await writeFile(directory + `text/${scene.id}-${name}.txt`, content)
  }
  let filter
  const args = [...docker]
  if (scene.file) args.push('-ss', String(scene.start), '-threads', '1', '-i', '/source/' + scene.file)
  else args.push('-f', 'lavfi', '-i', 'color=c=0xf6f3ee:s=1920x1080:r=30')
  const text = []
  if (scene.kind === 'phone') {
    filter = `[0:v]setpts=PTS-STARTPTS,split=2[full][focus];[full]crop=416:868:880:106,scale=432:900:flags=lanczos[phone];[focus]crop=${scene.crop},scale=960:608:flags=lanczos[inset];color=c=0xf6f3ee:s=1920x1080:r=30[base];[base][phone]overlay=200:100:shortest=1[a];[a]drawbox=x=756:y=251:w=968:h=616:color=0xd7d0c8:t=1[border];[border][inset]overlay=760:255:shortest=1[composition];`
    text.push(drawText(scene.id + '-section.txt', 'x=760:y=96', { size: 26, color: '0xc21f3a' }), drawText(scene.id + '-title.txt', 'x=760:y=151', { size: 43, border: 0.7 }), drawText(scene.id + '-caption.txt', 'x=760:y=915', { size: 33 }), drawText(scene.id + '-detail.txt', 'x=760:y=967', { size: 33 }))
  } else if (scene.kind === 'wide') {
    const [width] = scene.size.split(':').map(Number)
    filter = `[0:v]setpts=PTS-STARTPTS,crop=${scene.crop},scale=${scene.size}:flags=lanczos[footage];color=c=0xf6f3ee:s=1920x1080:r=30[base];[base][footage]overlay=${(1920 - width) / 2}:145:shortest=1[composition];`
    text.push(drawText(scene.id + '-section.txt', 'x=80:y=30', { size: 24, color: '0xc21f3a' }), drawText(scene.id + '-title.txt', 'x=80:y=73', { size: 42, border: 0.7 }), 'drawbox=x=80:y=944:w=1760:h=1:color=0xd7d0c8:t=fill', drawText(scene.id + '-caption.txt', 'x=(w-text_w)/2:y=967', { size: 33 }), drawText(scene.id + '-detail.txt', 'x=(w-text_w)/2:y=1015', { size: 30 }))
  } else if (scene.kind === 'card') {
    filter = '[0:v]setpts=PTS-STARTPTS[composition];'
    text.push(drawText(scene.id + '-section.txt', 'x=160:y=240', { size: 32, color: '0xc21f3a' }), drawText(scene.id + '-title.txt', 'x=160:y=355', { size: 74, border: 1 }), drawText(scene.id + '-caption.txt', 'x=164:y=520', { size: 43 }), drawText(scene.id + '-detail.txt', 'x=164:y=610', { size: 32, color: '0x666565' }))
  } else throw new Error('Unknown composition: ' + scene.kind)
  if (scene.kind === 'phone') text.push(drawText(scene.id + '-brand.txt', 'x=72:y=30', { size: 23, color: '0x666565' }))
  text.push(drawText(scene.id + '-count.txt', 'x=w-text_w-72:y=30', { size: 23, color: '0x666565' }))
  filter += `[composition]${text.join(',')},fade=t=in:st=0:d=0.12:color=0xf6f3ee,fade=t=out:st=${scene.duration - 0.12}:d=0.12:color=0xf6f3ee,setsar=1,format=yuv420p[out]`
  await writeFile(directory + scene.id + '.ffscript', filter)
  args.push('-filter_complex_script', '/out/' + scene.id + '.ffscript', '-map', '[out]')
  const preview = process.argv.includes('--preview')
  if (preview) args.push('-ss', String(Math.min(scene.duration / 2, 2)), '-frames:v', '1', '-threads', '1', '/out/qa/' + scene.id + '.png')
  else args.push('-t', String(scene.duration), ...codec, '/out/scenes/' + scene.id + '.mp4')
  const log = createWriteStream(directory + 'qa/' + scene.id + (preview ? '-preview.log' : '-encode.log'))
  const child = spawn('docker', args, { stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.pipe(log)
  const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  log.end()
  if (status !== 0) throw new Error('FFmpeg failed for ' + scene.id + '; inspect its log')
  subtitles.push({ start: cursor, end: cursor + scene.duration, text: scene.caption + '\n' + scene.detail })
  cursor += scene.duration
  console.log('Rendered', scene.id, scene.duration + 's')
  if (process.argv.includes('--first-only')) break
}

await writeFile(directory + 'timeline.json', JSON.stringify({ duration: cursor, scenes: timeline, subtitles }, null, 2))
const timestamp = seconds => new Date(seconds * 1000).toISOString().slice(11, 23).replace('.', ',')
await writeFile(directory + 'demo-ko.srt', subtitles.map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join('\n'))
await writeFile(directory + 'scenes/concat.txt', timeline.map(scene => `file '${scene.id}.mp4'`).join('\n') + '\n')
