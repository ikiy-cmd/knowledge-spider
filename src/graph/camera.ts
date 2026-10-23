import type { Point } from './layout';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface FitOptions {
  padding?: number;
  rightInset?: number;
  minZoom?: number;
  maxZoom?: number;
  animated?: boolean;
  centerBiasY?: number;
}

const MIN_ZOOM = 0.18;
const MAX_ZOOM = 3.2;

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export class Camera {
  state: CameraState = { x: 0, y: 0, zoom: 0.7 };

  private viewportWidth = 0;

  private viewportHeight = 0;

  private tween: {
    from: CameraState;
    to: CameraState;
    elapsed: number;
    duration: number;
  } | null = null;

  get width(): number {
    return this.viewportWidth;
  }

  get height(): number {
    return this.viewportHeight;
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  worldToScreen(point: Point): Point {
    return {
      x: (point.x - this.state.x) * this.state.zoom,
      y: (point.y - this.state.y) * this.state.zoom,
    };
  }

  screenToWorld(point: Point): Point {
    return {
      x: point.x / this.state.zoom + this.state.x,
      y: point.y / this.state.zoom + this.state.y,
    };
  }

  zoomAt(screenPoint: Point, zoomFactor: number): void {
    this.tween = null;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.state.zoom * zoomFactor));
    if (Math.abs(nextZoom - this.state.zoom) < 0.0001) return;
    const world = this.screenToWorld(screenPoint);
    this.state.zoom = nextZoom;
    this.state.x = world.x - screenPoint.x / nextZoom;
    this.state.y = world.y - screenPoint.y / nextZoom;
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.tween = null;
    this.state.x -= dxScreen / this.state.zoom;
    this.state.y -= dyScreen / this.state.zoom;
  }

  fit(bounds: Bounds, options: FitOptions = {}): void {
    const padding = options.padding ?? 88;
    const rightInset = options.rightInset ?? 0;
    const width = Math.max(1, this.viewportWidth - padding * 2 - rightInset);
    const height = Math.max(1, this.viewportHeight - padding * 2);
    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
    const minZoom = options.minZoom ?? 0.24;
    const maxZoom = options.maxZoom ?? 1.15;
    const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(width / boundsWidth, height / boundsHeight)));
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2 + (options.centerBiasY ?? 0);
    const targetScreenX = padding + width / 2;
    const targetScreenY = padding + height / 2;
    const next: CameraState = {
      x: centerX - targetScreenX / zoom,
      y: centerY - targetScreenY / zoom,
      zoom,
    };

    if (options.animated === false) {
      this.state = next;
      this.tween = null;
      return;
    }

    this.tween = {
      from: { ...this.state },
      to: next,
      elapsed: 0,
      duration: 0.62,
    };
  }

  focusPoint(
    worldPoint: Point,
    options: { zoom?: number; animate?: boolean; screenOffsetY?: number; screenOffsetX?: number } = {},
  ): void {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, options.zoom ?? this.state.zoom));
    const screenX = this.viewportWidth / 2 - (options.screenOffsetX ?? 0);
    const screenY = this.viewportHeight / 2 - (options.screenOffsetY ?? 0);
    const next: CameraState = {
      zoom: nextZoom,
      x: worldPoint.x - screenX / nextZoom,
      y: worldPoint.y - screenY / nextZoom,
    };
    if (options.animate === false) {
      this.state = next;
      this.tween = null;
      return;
    }
    this.tween = {
      from: { ...this.state },
      to: next,
      elapsed: 0,
      duration: 0.48,
    };
  }

  nudgeToInclude(
    worldPoint: Point,
    dt: number,
    options: { insetLeft?: number; insetRight?: number; insetTop?: number; insetBottom?: number } = {},
  ): void {
    if (this.tween) return;
    const screen = this.worldToScreen(worldPoint);
    const left = options.insetLeft ?? 180;
    const right = this.viewportWidth - (options.insetRight ?? 180);
    const top = options.insetTop ?? 150;
    const bottom = this.viewportHeight - (options.insetBottom ?? 150);
    let dx = 0;
    let dy = 0;
    if (screen.x < left) dx = left - screen.x;
    if (screen.x > right) dx = right - screen.x;
    if (screen.y < top) dy = top - screen.y;
    if (screen.y > bottom) dy = bottom - screen.y;
    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return;
    const smoothing = 1 - Math.exp(-4.5 * Math.max(0, dt));
    this.state.x -= (dx * smoothing) / this.state.zoom;
    this.state.y -= (dy * smoothing) / this.state.zoom;
  }

  followPoint(
    worldPoint: Point,
    dt: number,
    options: { rightInset?: number; topInset?: number; bottomInset?: number } = {},
  ): void {
    if (dt <= 0 || this.tween) return;
    const rightInset = Math.min(this.viewportWidth * 0.65, options.rightInset ?? 0);
    const top = options.topInset ?? 0;
    const bottom = options.bottomInset ?? 0;
    const screenX = (this.viewportWidth - rightInset) / 2;
    const screenY = top + (this.viewportHeight - top - bottom) / 2;
    const targetX = worldPoint.x - screenX / this.state.zoom;
    const targetY = worldPoint.y - screenY / this.state.zoom;
    const smoothing = 1 - Math.exp(-4 * dt);
    this.state.x += (targetX - this.state.x) * smoothing;
    this.state.y += (targetY - this.state.y) * smoothing;
  }

  update(dt: number): boolean {
    if (!this.tween) return false;
    this.tween.elapsed += dt;
    const t = Math.min(1, this.tween.elapsed / this.tween.duration);
    const eased = easeOutCubic(t);
    this.state.zoom = lerp(this.tween.from.zoom, this.tween.to.zoom, eased);
    this.state.x = lerp(this.tween.from.x, this.tween.to.x, eased);
    this.state.y = lerp(this.tween.from.y, this.tween.to.y, eased);
    if (t >= 1) {
      this.state = { ...this.tween.to };
      this.tween = null;
    }
    return true;
  }

  get isAnimating(): boolean {
    return this.tween !== null;
  }

  cancelTween(): void {
    this.tween = null;
  }
}
