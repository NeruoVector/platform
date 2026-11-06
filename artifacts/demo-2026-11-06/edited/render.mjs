import { chromium } from '../../../monitoring/node_modules/playwright-core/index.mjs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import assert from 'node:assert/strict'
import { timeline } from './timeline.mjs'

const output = fileURLToPath(new URL('.', import.meta.url))
await mkdir(output + 'assets', { recursive: true })
await mkdir(output + 'qa', { recursive: true })
await copyFile(homedir() + '/.local/share/fonts/nv-qa/NotoSansKR-VF.ttf', output + 'assets/NotoSansKR.ttf')
const browser = await chromium.launch({
  executablePath: homedir() + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const cuts = []
let cursor = 0
const css = `
@font-face{font-family:Noto;src:url('assets/NotoSansKR.ttf')}*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
body{font-family:Noto,sans-serif;background:#faf7f2;color:#292524}.brand{position:absolute;left:96px;top:42px;font-size:40px;font-weight:850;color:#c21f3a}
.section{position:absolute;right:96px;top:61px;font-size:24px;color:#78716c}.title{position:absolute;left:112px;top:310px;width:640px;font-size:64px;font-weight:800;line-height:1.35;letter-spacing:-2px;margin:0}
.customer .title{left:160px}.admin .title{left:445px;top:52px;font-size:32px;line-height:1.4;width:1000px;letter-spacing:-1px}.footage{position:absolute;overflow:hidden}
video{position:absolute;max-width:none}.caption{position:absolute;left:96px;right:96px;top:950px;border-top:1px solid #eae3dc;padding-top:24px;font-size:36px;line-height:1.4;margin:0}
.card .title{left:160px;top:330px;width:1600px;font-size:108px;line-height:1.3;letter-spacing:-4px}.card .subtitle{position:absolute;left:166px;top:514px;font-size:46px;line-height:1.5;margin:0}
.card .disclosure{position:absolute;left:168px;top:710px;font-size:30px;color:#78716c}.outro .title{font-size:88px;letter-spacing:-3px}
`
try {
  for (const clip of timeline) {
    const customer = clip.source === 'customer.webm'
    const admin = clip.source?.startsWith('page@') ?? false
    const kind = clip.source ? (customer ? 'customer' : admin ? 'admin' : 'monitor') : 'card'
    const crop = customer ? { x:875, y:100, w:430, h:880, scale:800/880, left:1210, top:130 }
      : admin ? { x:0, y:0, w:1920, h:1080, scale:800/1080, left:249, top:130 }
      : { x:370, y:140, w:1180, h:940, scale:780/940, left:837, top:150 }
    const original = admin ? output + 'assets/admin-source.webm' : output + '../raw/' + clip.source
    const video = clip.source ? `<div class="footage" style="left:${crop.left}px;top:${crop.top}px;width:${crop.w*crop.scale}px;height:${crop.h*crop.scale}px"><video preload="auto" muted src="${pathToFileURL(original).href}" style="left:${-crop.x*crop.scale}px;top:${-crop.y*crop.scale}px;width:${1920*crop.scale}px;height:${1080*crop.scale}px"></video></div>` : ''
    const details = clip.source ? '' : `<p class="subtitle">${clip.id === 'intro' ? '주문부터 드론 모니터링까지' : '실제 서비스 화면으로 확인하는 흐름'}</p><p class="disclosure">테스트 결제 · Gazebo/PX4 시뮬레이터</p>`
    const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${clip.heading.replaceAll('\n',' ')}</title><style>${css}</style><body class="${kind} ${clip.id}"><header><span class="brand">교내 배달</span><span class="section">${clip.section}</span></header><h1 class="title">${clip.heading.replaceAll('\n','<br>')}</h1>${details}${video}<p class="caption">${clip.cue}</p></body></html>`
    await writeFile(output + 'stage.html', html)
    await page.goto(pathToFileURL(output + 'stage.html').href)
    await page.evaluate(() => document.fonts.ready)
    await page.locator('body').ariaSnapshot()
    if (clip.source) {
      await page.locator('video').evaluate(async (v, time) => {
        await new Promise((resolve, reject) => {
          const seek = () => {
            v.addEventListener('seeked', resolve, { once: true })
            v.currentTime = time
          }
          v.addEventListener('error', () => reject(new Error('Video failed to load')), { once: true })
          if (v.readyState >= 1) seek()
          else v.addEventListener('loadedmetadata', seek, { once: true })
        })
      }, clip.start + clip.seconds / 2)
      assert.equal(await page.locator('video').evaluate(v => v.readyState >= 2), true)
    }
    const bounds = await page.locator('.caption').evaluate(el => ({ width:el.clientWidth, content:el.scrollWidth, height:el.getBoundingClientRect().bottom, font:getComputedStyle(el).fontFamily }))
    assert.ok(bounds.content <= bounds.width && bounds.height <= 1060, clip.id + ': caption overflow')
    assert.ok(bounds.font.includes('Noto'))
    await page.screenshot({ path:output+'qa/'+clip.id+'-preview.png' })
    if (clip.source) await page.locator('.footage').evaluate(el => { el.style.visibility = 'hidden' })
    await page.screenshot({ path:output+'assets/'+clip.id+'.png' })
    cuts.push({ ...clip, at:cursor, end:cursor+clip.seconds, kind, crop })
    cursor += clip.seconds
  }
  const stamp = (seconds, decimal) => {
    const ms = Math.round(seconds * 1000)
    return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(n=>String(n).padStart(2,'0')).join(':')+decimal+String(ms%1000).padStart(3,'0')
  }
  const srt = cuts.map((c,i)=>`${i+1}\n${stamp(c.at,',')} --> ${stamp(c.end,',')}\n${c.cue}\n`).join('\n')
  await writeFile(output+'demo-ko.srt',srt)
  await writeFile(output+'demo-ko.vtt','WEBVTT\n\n'+cuts.map(c=>`${stamp(c.at,'.')} --> ${stamp(c.end,'.')}\n${c.cue}\n`).join('\n'))
  await writeFile(output+'cuts.json',JSON.stringify({ duration:cursor, width:1920, height:1080, fps:25, cuts },null,2))
  await writeFile(output+'qa/render-result.json',JSON.stringify({ clips:cuts.length, duration:cursor, captionBounds:true, koreanFont:true, sourceSeek:true },null,2))
  console.log('Rendered',cuts.length,'shots;',cursor,'seconds; captions and source seek verified.')
} finally {
  await context.close()
  await browser.close()
}
