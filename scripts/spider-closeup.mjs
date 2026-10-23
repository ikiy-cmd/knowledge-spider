import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\KTogetherY\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1100);
const debug = await page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot());
const node = debug.nodes.find((entry) => entry.id === 't-retrieval');
const canvas = await page.locator('[data-testid="knowledge-canvas"]').boundingBox();
await page.mouse.click(canvas.x + node.screen.x, canvas.y + node.screen.y);
await page.waitForTimeout(7600);
await page.locator('[data-testid="close-panel"]').click();
await page.waitForTimeout(400);
const after = await page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot());
fs.mkdirSync(path.resolve('artifacts'), { recursive: true });
await page.screenshot({ path: path.resolve('artifacts/arrived.png'), fullPage: true });
const sx = after.spider.screen.x;
const sy = after.spider.screen.y + (canvas?.y ?? 0);
await page.screenshot({
  path: path.resolve('artifacts/spider-closeup.png'),
  clip: { x: Math.max(0, sx - 170), y: Math.max(0, sy - 140), width: 340, height: 300 },
});
console.log(JSON.stringify({ phase: after.phase, body: after.spider.screen, heading: after.spider.heading, legs: after.spider.legs }, null, 2));
await browser.close();
