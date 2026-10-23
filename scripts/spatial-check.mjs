import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\KTogetherY\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const debug = () => page.evaluate(() => window.__ZHUZHI_DEV__.debugSnapshot());
const positions = () => page.evaluate(() => window.__ZHUZHI_DEV__.graph.nodes.map(node => ({ id: node.id, x: node.x, y: node.y, spatial: { ...node.spatial } })));
try {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const initial = await positions();
  await page.getByTestId('orbit-right').click();
  const rotated = await positions();
  assert.ok(Math.hypot(initial[0].x - rotated[0].x, initial[0].y - rotated[0].y) > 10, 'rotation changes the projected view');
  for (let i = 0; i < initial.length; i++) {
    const length = p => Math.hypot(p.spatial.x, p.spatial.y, p.spatial.z);
    assert.ok(Math.abs(length(initial[i]) - length(rotated[i])) < 1e-8, 'rotation preserves 3D distances');
  }
  await page.getByTestId('orbit-left').click();
  const restored = await positions();
  for (let i = 0; i < initial.length; i++) assert.ok(Math.hypot(initial[i].x - restored[i].x, initial[i].y - restored[i].y) < 1e-8);
  console.log('PASS orbit controls: perspective changes, distances preserved, inverse rotation restores view');

  const box = await page.getByTestId('knowledge-canvas').boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 180, box.y + box.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + box.height * 0.65 + 60, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  assert.notDeepEqual(await positions(), restored);
  await page.getByTestId('reset-layout').click();
  assert.deepEqual(await positions(), initial, 'reset restores spatial coordinates as well as screen layout');
  console.log('PASS Shift-drag rotation and complete layout reset');

  const current = await debug();
  const target = current.nodes.find(node => node.id === 'f-tool-least-privilege');
  assert.ok(target);
  const start = target.screen;
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + start.x + 35, box.y + start.y + 20, { steps: 10 });
  await page.mouse.up();
  const dragged = (await debug()).nodes.find(node => node.id === target.id);
  assert.ok(Math.abs(dragged.screen.x - start.x - 35) < 2, 'node follows pointer without jumping to old cluster');
  await page.getByTestId('reset-layout').click();
  console.log('PASS node drag follows pointer in spherical layout');

  const spider = (await debug()).spider.screen;
  await page.mouse.move(box.x + spider.x + 29, box.y + spider.y);
  await page.mouse.down();
  await page.mouse.move(box.x + spider.x + 54, box.y + spider.y + 15, { steps: 8 });
  assert.equal((await debug()).phase, 'dragging', 'enlarged spider body is draggable');
  await page.mouse.up();
  console.log('PASS enlarged spider body hit area');

  await page.reload({ waitUntil: 'networkidle' });
  await page.mouse.move(720, 400);
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(100);
  const zoomed = await debug();
  const distant = zoomed.nodes.find(node => node.id === 'f-tool-least-privilege');
  await page.mouse.move(box.x + distant.screen.x, box.y + distant.screen.y);
  await page.mouse.down();
  await page.mouse.move(box.x + distant.screen.x + 500, box.y + distant.screen.y, { steps: 15 });
  await page.mouse.up();
  for (let i = 0; i < 3; i++) await page.getByTestId('orbit-left').click();
  const afterDistantDrag = (await debug()).nodes.find(node => node.id === distant.id);
  assert.ok(afterDistantDrag.world.x > 0 && afterDistantDrag.world.x < 5000, 'large drag followed by orbit stays on the correct side of the camera');
  console.log('PASS zoomed-out large drag then rotation stays stable');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'artifacts/spatial-desktop.png', fullPage: true });
  console.log('DESKTOP FPS', await page.evaluate(() => window.__ZHUZHI_DEV__.getFps()));
  for (const viewport of [{ width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal page overflow');
    const view = await debug();
    assert.ok(view.nodes.every(node => node.screen.x >= 20 && node.screen.x <= viewport.width - 20), 'fresh viewport fits the whole knowledge sphere');
    const orbit = await page.getByTestId('orbit-right').boundingBox();
    assert.ok(orbit.x >= 0 && orbit.x + orbit.width <= viewport.width);
    await page.getByTestId('orbit-right').click();
    await page.screenshot({ path: `artifacts/spatial-${viewport.width}.png`, fullPage: true });
    console.log(`PASS ${viewport.width}px: no overflow and usable rotation controls`);
  }
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS no browser errors');
} finally {
  await browser.close();
}
