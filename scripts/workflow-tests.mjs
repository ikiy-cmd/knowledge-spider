import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\KTogetherY\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
fs.mkdirSync('artifacts', { recursive: true });

async function state() {
  return page.evaluate(() => window.__ZHUZHI_DEV__.getUiState());
}
async function debug() {
  return page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot());
}

await page.fill('[data-testid="query-input"]', 'BM25 为什么需要稳定排序？');
await page.click('[data-testid="search-submit"]');
const start = Date.now();

// pause mid travel
await page.waitForTimeout(850);
await page.click('[data-testid="toggle-pause"]');
await page.waitForTimeout(200);
const pausedA = await state();
const debugA = await debug();
await page.waitForTimeout(1200);
const pausedB = await state();
const debugB = await debug();
console.log('PAUSE', {
  phaseA: pausedA.phase,
  phaseB: pausedB.phase,
  bodyDrift: Math.hypot(debugA.spider.body.x - debugB.spider.body.x, debugA.spider.body.y - debugB.spider.body.y),
  paused: pausedB.paused,
  demoStatus: pausedB.demo.status,
});

await page.click('[data-testid="toggle-pause"]');
let stateNow = await state();
for (let i = 0; i < 90; i += 1) {
  await page.waitForTimeout(500);
  stateNow = await state();
  if (stateNow.demo.status === 'complete') break;
}
const elapsed = (Date.now() - start) / 1000;
console.log('AUTO_COMPLETE', { elapsed, demo: stateNow.demo, phase: stateNow.phase });
await page.screenshot({ path: 'artifacts/auto-complete.png', fullPage: true });

// replay
await page.click('[data-testid="replay-demo"]');
await page.waitForTimeout(1200);
const replayState = await state();
console.log('REPLAY', { demoStatus: replayState.demo.status, visited: replayState.demo.visited, queryId: await page.locator('.results-heading .eyebrow').first().innerText() });

// pause auto by clicking a node on canvas
const panelClose = page.locator('[data-testid="close-panel"]');
if (await panelClose.isVisible()) await panelClose.click();
await page.waitForTimeout(300);
const dbg = await debug();
const clickTarget = dbg.nodes.find((n) => n.id === 't-governance');
const canvas = await page.locator('[data-testid="knowledge-canvas"]').boundingBox();
await page.mouse.click(canvas.x + clickTarget.screen.x, canvas.y + clickTarget.screen.y);
await page.waitForTimeout(250);
const manualTakeover = await state();
console.log('MANUAL_TAKEOVER', { mode: manualTakeover.mode, demoStatus: manualTakeover.demo.status, selected: manualTakeover.selectedId, phase: manualTakeover.phase });
await page.waitForTimeout(5200);
const manualDone = await state();
console.log('MANUAL_DONE', { mode: manualDone.mode, demoStatus: manualDone.demo.status, phase: manualDone.phase, visited: manualDone.demo.visited });
console.log('RESUME_BUTTON_VISIBLE', await page.locator('[data-testid="resume-auto"]').isVisible().catch(() => false));

await page.click('[data-testid="resume-auto"]');
await page.waitForTimeout(1200);
const resumed = await state();
console.log('RESUMED', { mode: resumed.mode, demoStatus: resumed.demo.status, phase: resumed.phase, target: resumed.targetId });

// Stop movement while moving
await page.click('[data-testid="stop-motion"]');
await page.waitForTimeout(100);
const stopped = await state();
console.log('STOPPED', { phase: stopped.phase, demoStatus: stopped.demo.status, target: stopped.targetId, paused: stopped.paused });

// No results query
await page.fill('[data-testid="query-input"]', '完全不存在的银河词条xyz');
await page.click('[data-testid="search-submit"]');
await page.waitForTimeout(700);
const emptyState = await state();
const panelText = await page.locator('[data-testid="side-panel"]').innerText();
console.log('EMPTY', { demoStatus: emptyState.demo.status, phase: emptyState.phase, hasEmpty: panelText.includes('没有找到匹配证据'), hasFake: panelText.includes('虚构') });
await page.screenshot({ path: 'artifacts/empty-results.png', fullPage: true });

// Long query then immediate replacement
await page.fill('[data-testid="query-input"]', 'BM25 稳定排序');
await page.click('[data-testid="search-submit"]');
await page.waitForTimeout(500);
await page.fill('[data-testid="query-input"]', '查询快照与回放');
await page.click('[data-testid="search-submit"]');
await page.waitForTimeout(800);
const panelText2 = await page.locator('[data-testid="side-panel"]').innerText();
const seqLine = await page.locator('.results-heading .eyebrow').first().innerText();
console.log('REPEAT_QUERY', { seqLine, containsOldQuery: panelText2.includes('BM25 稳定排序'), containsNewQuery: panelText2.includes('查询快照与回放') });
console.log('ERRORS', errors);
await browser.close();
