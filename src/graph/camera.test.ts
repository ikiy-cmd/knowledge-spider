import { describe, expect, it } from 'vitest';
import { Camera } from './camera';

function camera() {
  const view = new Camera();
  view.setViewport(1200, 800);
  view.state = { x: 0, y: 0, zoom: 1 };
  return view;
}

describe('moving camera follow', () => {
  it('smoothly centers the moving subject in the space beside an open panel', () => {
    const view = camera();
    expect(view.followPoint).toBeTypeOf('function');
    view.followPoint({ x: 600, y: 400 }, 1 / 60, { rightInset: 400 });
    expect(view.state.x).toBeGreaterThan(0);
    expect(view.state.x).toBeLessThan(200);
    for (let frame = 0; frame < 240; frame++) view.followPoint({ x: 600, y: 400 }, 1 / 60, { rightInset: 400 });
    expect(view.worldToScreen({ x: 600, y: 400 }).x).toBeCloseTo(400, 0);
    expect(view.state.zoom).toBe(1);
  });

  it('does not move when animation time is paused', () => {
    const view = camera();
    expect(view.followPoint).toBeTypeOf('function');
    view.followPoint({ x: 900, y: 700 }, 0);
    expect(view.state).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('has the same tracking speed at different frame rates', () => {
    const slow = camera();
    const fast = camera();
    expect(slow.followPoint).toBeTypeOf('function');
    for (let frame = 0; frame < 30; frame++) slow.followPoint({ x: 900, y: 600 }, 1 / 30);
    for (let frame = 0; frame < 120; frame++) fast.followPoint({ x: 900, y: 600 }, 1 / 120);
    expect(slow.state.x).toBeCloseTo(fast.state.x, 6);
    expect(slow.state.y).toBeCloseTo(fast.state.y, 6);
  });
});
