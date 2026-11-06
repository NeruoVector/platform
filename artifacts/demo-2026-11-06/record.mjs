import { chromium } from '/home/helloworld0822/coding/platform-damselfish/monitoring/node_modules/playwright-core/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const output = fileURLToPath(new URL('.', import.meta.url))
const mode = process.argv[2] ?? 'customer'
const origin = 'http://127.0.0.1:18083'
const browser = await chromium.launch({
  executablePath: '/home/helloworld0822/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
let storageState
if (mode === 'admin') {
  const authentication = await browser.newContext()
  try {
    const response = await authentication.request.post(origin + '/api/v1/admin/auth/login', {
      data: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD },
    })
    if (!response.ok()) throw new Error('Admin authentication failed: HTTP ' + response.status())
    storageState = await authentication.storageState()
  } finally {
    await authentication.close()
  }
}
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: output + 'raw', size: { width: 1920, height: 1080 } },
  locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light',
  storageState,
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
const started = Date.now()
const chapters = []

async function chapter(label) {
  chapters.push({ seconds: (Date.now() - started) / 1000, label, url: page.url() })
  console.log(mode, chapters.at(-1))
  await page.screenshot({ path: output + 'stills/' + mode + '-' + chapters.length + '.png' })
}

async function clickButton(name) {
  const target = page.getByRole('button', { name, exact: true })
  await target.hover()
  await page.waitForTimeout(650)
  await target.click()
  await page.waitForTimeout(1700)
}

try {
  await mkdir(output + 'stills', { recursive: true })
  switch (mode) {
    case 'customer': {
      await page.goto(origin + '/#/home')
      await page.getByRole('button', { name: '청포도젤리 50g, 1,000원', exact: true }).waitFor()
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(2500)
      await chapter('홈 · 매점 상품')
      await page.waitForTimeout(4000)
      await page.getByRole('tab', { name: '음료', exact: true }).click()
      await chapter('음료 카테고리')
      await page.waitForTimeout(3500)
      await page.getByRole('tab', { name: '젤리', exact: true }).click()
      await page.waitForTimeout(2500)
      await clickButton('청포도젤리 50g, 1,000원')
      await chapter('상품 상세 · 옵션과 수량')
      await page.waitForTimeout(3500)
      await page.getByRole('checkbox', { name: '봉투 포함 무료', exact: true }).check()
      await clickButton('수량 늘리기')
      await page.waitForTimeout(2500)
      await page.getByRole('button', { name: /담기/ }).click()
      await page.getByRole('heading', { name: '장바구니', exact: true }).waitFor()
      await chapter('장바구니 · 금액 확인')
      await page.waitForTimeout(3500)
      await page.getByRole('textbox', { name: '필요한 내용을 알려주세요' }).fill('봉투는 한 장만 주세요')
      await page.waitForTimeout(3000)
      await page.getByRole('button', { name: /원 주문하기/ }).click()
      await page.getByRole('heading', { name: '주문 / 결제', exact: true }).waitFor()
      await chapter('주문 · 테스트 결제 안내')
      await page.waitForTimeout(4500)
      await clickButton('변경')
      await chapter('수령 장소 선택')
      await page.waitForTimeout(5000)
      await page.goto(origin + '/#/home')
      await page.getByRole('button', { name: '장바구니 2개', exact: true }).waitFor()
      await page.waitForTimeout(4000)
      break
    }
    case 'monitor': {
      await page.goto(origin + '/monitor/#map')
      await page.getByRole('img', { name: '학교 전체 3D 지도와 실시간 기체 위치' }).waitFor()
      await page.waitForTimeout(4500)
      await chapter('학교 전체 3D 지도 · 기체 위치')
      await page.waitForTimeout(5500)
      await clickButton('위에서 보기')
      await chapter('학교 지도 · 탑뷰')
      await page.waitForTimeout(4000)
      await clickButton('전체 보기')
      const canvas = page.getByRole('img', { name: '학교 전체 3D 지도와 실시간 기체 위치' })
      const box = await canvas.boundingBox()
      if (box === null) throw new Error('Campus canvas is outside the viewport')
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.55, { steps: 75 })
      await page.mouse.up()
      await page.waitForTimeout(4000)
      await chapter('학교 지도 · 회전')
      await clickButton('기체 찾기')
      await page.waitForTimeout(4500)
      await chapter('기체 위치 확대')
      await clickButton('전체 보기')
      await page.waitForTimeout(3000)
      await clickButton('모니터링')
      await chapter('감지 이력 · 드론 상태')
      await page.waitForTimeout(6000)
      break
    }
    case 'admin': {
      await page.goto(origin + '/nv-dash/products')
      await page.getByRole('heading', { name: '상품 관리', exact: true }).waitFor()
      await page.getByRole('tab', { name: /판매 중/ }).click()
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(3000)
      await chapter('관리자 · 판매 중 상품과 재고')
      await page.waitForTimeout(5000)
      await page.getByRole('textbox').fill('청포도')
      await page.waitForTimeout(3500)
      await chapter('상품명 검색')
      await page.waitForTimeout(2500)
      await page.getByRole('link', { name: '수정', exact: true }).first().click()
      await page.waitForTimeout(2500)
      await chapter('상품 상세 · 가격과 재고 · 사진 관리')
      await page.waitForTimeout(5000)
      await page.getByRole('link', { name: '드론 현황', exact: true }).click()
      await page.getByRole('heading', { name: '드론 현황', exact: true }).waitFor()
      await page.waitForTimeout(2500)
      await chapter('관리자 · 드론 운용 상태')
      await page.waitForTimeout(6000)
      await page.getByRole('link', { name: '상품 관리', exact: true }).click()
      await page.getByRole('tab', { name: /판매 중/ }).click()
      await page.waitForTimeout(4000)
      break
    }
    default:
      throw new Error('Unsupported recording mode: ' + mode)
  }
  await writeFile(output + mode + '-chapters.json', JSON.stringify(chapters, null, 2))
} finally {
  const video = page.video()
  await context.close()
  await video.saveAs(output + 'raw/' + mode + '.webm')
  await browser.close()
}
