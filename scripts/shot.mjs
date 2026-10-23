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
  if (message.type() === 'error' || message.type() === 'warning') logs.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
fs.mkdirSync(path.resolve('artifacts'), { recursive: true });
await page.screenshot({ path: path.resolve('artifacts/initial.png'), fullPage: true });
console.log('TITLE', await page.title());
console.log('HUD', await page.locator('[data-testid="hud-status"]').innerText());
console.log('NODECOUNT', await page.locator('.brand-sub').innerText());
console.log('LOGS', JSON.stringify(logs, null, 2));
await browser.close();
