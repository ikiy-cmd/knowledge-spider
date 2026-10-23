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
fs.mkdirSync(path.resolve('artifacts'), { recursive: true });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
const canvas = page.locator('[data-testid="knowledge-canvas"]');
const box = await canvas.boundingBox();
const debug = await page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot());
const targetNode = debug.nodes.find((node) => node.id === 't-retrieval') ?? debug.nodes[0];
console.log('CANVAS', box, 'TARGET', targetNode);
if (box && targetNode) {
  await page.mouse.click(box.x + targetNode.screen.x, box.y + targetNode.screen.y);
}
await page.waitForTimeout(450);
await page.screenshot({ path: path.resolve('artifacts/click-045.png'), fullPage: true });
console.log('AFTER CLICK HUD', await page.locator('[data-testid="hud-status"]').innerText());
console.log('PANEL OPEN', await page.locator('[data-testid="side-panel"]').getAttribute('class'));
console.log('DEBUG AFTER CLICK', await page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot().phase));
await page.waitForTimeout(2600);
await page.screenshot({ path: path.resolve('artifacts/click-305.png'), fullPage: true });
console.log('AFTER 3S HUD', await page.locator('[data-testid="hud-status"]').innerText());
console.log('PANEL TEXT', (await page.locator('[data-testid="side-panel"]').innerText()).slice(0, 500));
console.log('LOGS', logs);
await browser.close();
