import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\KTogetherY\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe', headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const debug = () => page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot());

try {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  const canvas = page.getByTestId('knowledge-canvas');
  const box = await canvas.boundingBox();
  const backing = await canvas.evaluate(element => ({ width: element.width, cssWidth: element.getBoundingClientRect().width }));
  assert.ok(backing.width >= backing.cssWidth * 1.9, 'high resolution text backing at 1× display scale');
  assert.ok(await page.getByTestId('query-input').evaluate(element => parseFloat(getComputedStyle(element).fontSize)) >= 15);
  const initial = await debug();
  const target = initial.nodes.find(node => node.id === 't-retrieval');
  await page.mouse.click(box.x + target.screen.x, box.y + target.screen.y);
  await page.waitForFunction(() => window.__ZHUZHI_DEV__.debugSnapshot().spider.legs.some(leg => leg.contactAt > 0));
  await page.getByTestId('toggle-pause').click();
  const contact = await debug();
  assert.ok(contact.spider.legs.some(leg => leg.contactAt > 0 && leg.contactNodeId));
  const paused = await debug();
  await page.waitForTimeout(450);
  assert.deepEqual((await debug()).camera, paused.camera, 'camera freezes while paused');
  assert.deepEqual((await debug()).spider.legs, paused.spider.legs, 'tentacle landing animation freezes while paused');
  await page.screenshot({ path: 'artifacts/tentacle-contact.png', fullPage: true });
  console.log('PASS larger text, high resolution canvas, real contact state and pause');
  await page.getByTestId('fit-view').click();
  await page.waitForTimeout(800);
  assert.notDeepEqual((await debug()).camera, paused.camera, 'manual fit remains available while motion is paused');
  assert.equal((await debug()).paused, true);
  await page.getByTestId('spatial-follow').click();
  console.log('PASS manual fit while paused');
  await page.getByTestId('toggle-pause').click();
  await page.waitForFunction(() => window.__ZHUZHI_DEV__.getUiState().phase === 'arrived', { timeout: 20000 });
  const arrived = await debug();
  const availableWidth = box.width - 412;
  assert.ok(Math.abs(arrived.spider.screen.x - availableWidth / 2) < 95, 'camera tracks the spider beside the detail panel');
  assert.ok(Math.hypot(arrived.camera.x - initial.camera.x, arrived.camera.y - initial.camera.y) > 50, 'viewpoint moved with the spider');
  for (const leg of arrived.spider.legs) {
    if (!leg.anchor) continue;
    const node = arrived.nodes.find(entry => entry.id === leg.anchor);
    assert.ok(Math.hypot(leg.foot.x - node.world.x, leg.foot.y - node.world.y) < 1e-6, 'anchored tips remain exactly on nodes');
    assert.ok(leg.extension <= 1.53, 'tentacle extension is bounded');
  }
  await page.screenshot({ path: 'artifacts/moving-follow.png', fullPage: true });
  console.log('PASS smooth subject follow, panel clearance and exact tentacle contact points');

  await page.getByTestId('toggle-follow').click();
  assert.equal(await page.getByTestId('spatial-follow').getAttribute('aria-pressed'), 'false');
  const fixed = (await debug()).camera;
  await page.evaluate(() => window.__ZHUZHI_DEV__.selectNode('t-governance'));
  await page.waitForTimeout(1200);
  assert.deepEqual((await debug()).camera, fixed, 'disabled follow respects the manually chosen view');
  await page.getByTestId('spatial-follow').click();
  assert.equal(await page.getByTestId('toggle-follow').getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(500);
  const following = (await debug()).camera;
  assert.notDeepEqual(following, fixed, 'follow can resume while traveling');
  await page.getByTestId('fit-view').click();
  await page.waitForTimeout(800);
  const fitted = (await debug()).camera;
  await page.waitForTimeout(600);
  assert.deepEqual((await debug()).camera, fitted, 'fit view remains stable after following a moving spider');
  console.log('PASS follow on/off and fit-view manual override');
  assert.deepEqual(errors, []);
  console.log('PASS no browser errors');
} finally {
  await browser.close();
}
