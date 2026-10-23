import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\KTogetherY\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (message) => {
  if (message.type() === 'error') logs.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.fill('[data-testid="query-input"]', 'BM25 为什么需要稳定排序？');
await page.click('[data-testid="search-submit"]');
await page.waitForTimeout(700);
await page.screenshot({ path: path.resolve('artifacts/search-early.png'), fullPage: true });
const resultsText = await page.locator('[data-testid="side-panel"]').innerText();
console.log('EARLY PANEL', resultsText.slice(0, 1600));
const debug1 = await page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot());
console.log('EARLY', JSON.stringify({ phase: debug1.phase, body: debug1.spider.screen, target: debug1.spider.target }, null, 2));
await page.waitForTimeout(2200);
await page.screenshot({ path: path.resolve('artifacts/search-travel.png'), fullPage: true });
console.log('T+2.9 HUD', await page.locator('[data-testid="hud-status"]').innerText());
console.log('T+2.9 DEMO', await page.evaluate(() => window.__ZHUZHI_DEV__.getUiState().demo));
// wait until demo completed or 25s
let state = null;
for (let i = 0; i < 80; i += 1) {
  await page.waitForTimeout(500);
  state = await page.evaluate(() => window.__ZHUZHI_DEV__.getUiState());
  if (state.demo.status === 'complete') break;
}
console.log('FINAL DEMO', JSON.stringify(state.demo, null, 2));
console.log('FINAL PHASE', state.phase, 'TARGET', state.targetId);
await page.screenshot({ path: path.resolve('artifacts/search-complete.png'), fullPage: true });
console.log('FINAL PANEL TAIL', (await page.locator('[data-testid="side-panel"]').innerText()).slice(-900));
console.log('LOGS', logs);
await browser.close();
