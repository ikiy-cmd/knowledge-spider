import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\KTogetherY\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const debug = await page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot());
const node = debug.nodes.find((entry) => entry.id === 't-retrieval');
const canvas = await page.locator('[data-testid="knowledge-canvas"]').boundingBox();
console.log('INIT', JSON.stringify({ body: debug.spider, reach: debug.spider.reach, zoom: debug.camera.zoom }, null, 2));
await page.mouse.click(canvas.x + node.screen.x, canvas.y + node.screen.y);
for (let i = 0; i < 14; i += 1) {
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot());
  console.log(
    `T+${(i + 1) * 0.5}s`,
    JSON.stringify({
      phase: state.phase,
      body: { x: Math.round(state.spider.screen.x), y: Math.round(state.spider.screen.y) },
      dest: { x: Math.round(state.spider.destinationScreen.x), y: Math.round(state.spider.destinationScreen.y) },
      speed: Math.round(Math.hypot(state.spider.velocity.x, state.spider.velocity.y) * 10) / 10,
      mode: state.spider.mode,
      legs: state.spider.legs.map((leg) => `${leg.id}:${leg.anchor ? leg.anchor.slice(0, 7) : leg.swing ? 'swing' : '-'}`).join(' '),
    }),
  );
}
await browser.close();
