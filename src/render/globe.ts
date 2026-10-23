import type { Camera } from '../graph/camera';
import { SPHERE_EXTENT, SPHERE_RADIUS, projectSpatial, rotateSpatialPoint, transformSpatial, type SpatialPoint } from '../graph/sphere';

const TAU = Math.PI * 2;
const gridCache = new WeakMap<readonly SpatialPoint[], SpatialPoint[][]>();

function gridFor(axes: readonly SpatialPoint[]): SpatialPoint[][] {
  const cached = gridCache.get(axes);
  if (cached) return cached;
  const curves: SpatialPoint[][] = [];
  for (let ring = 0; ring < 5; ring++) {
    const curve: SpatialPoint[] = [];
    for (let step = 0; step <= 96; step++) {
      const angle = step / 96 * TAU;
      const longitude = ring * Math.PI / 3;
      const latitude = ring === 3 ? -0.48 : 0.48;
      const point = ring < 3
        ? { x: Math.cos(angle) * Math.cos(longitude), y: Math.sin(angle), z: Math.cos(angle) * Math.sin(longitude) }
        : { x: Math.cos(angle) * Math.cos(latitude), y: Math.sin(latitude), z: Math.sin(angle) * Math.cos(latitude) };
      const tilted = rotateSpatialPoint({ x: point.x * SPHERE_RADIUS, y: point.y * SPHERE_RADIUS, z: point.z * SPHERE_RADIUS }, 0.42, -0.24);
      curve.push(transformSpatial(tilted, axes));
    }
    curves.push(curve);
  }
  gridCache.set(axes, curves);
  return curves;
}

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, axes: readonly SpatialPoint[], front: boolean): void {
  ctx.save();
  ctx.strokeStyle = front ? 'rgba(139, 191, 212, 0.105)' : 'rgba(124, 153, 184, 0.035)';
  ctx.lineWidth = front ? 0.75 : 0.6;
  ctx.beginPath();
  for (const curve of gridFor(axes)) {
    for (let index = 1; index < curve.length; index++) {
      const a = curve[index - 1];
      const b = curve[index];
      if (((a.z + b.z) / 2 >= 0) !== front) continue;
      const p = camera.worldToScreen(projectSpatial(a));
      const q = camera.worldToScreen(projectSpatial(b));
      ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

export function drawGlobeBack(ctx: CanvasRenderingContext2D, camera: Camera, axes: readonly SpatialPoint[]): void {
  const center = camera.worldToScreen({ x: 0, y: 0 });
  const radius = SPHERE_EXTENT * camera.state.zoom;
  ctx.save();
  const halo = ctx.createRadialGradient(center.x - radius * 0.32, center.y - radius * 0.4, radius * 0.2, center.x, center.y, radius * 1.18);
  halo.addColorStop(0, 'rgba(64, 112, 145, 0.12)');
  halo.addColorStop(0.72, 'rgba(38, 75, 109, 0.07)');
  halo.addColorStop(0.86, 'rgba(55, 112, 143, 0.10)');
  halo.addColorStop(1, 'rgba(20, 50, 80, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(center.x - radius * 1.2, center.y - radius * 1.2, radius * 2.4, radius * 2.4);
  const fill = ctx.createRadialGradient(center.x - radius * 0.35, center.y - radius * 0.45, 0, center.x + radius * 0.18, center.y + radius * 0.15, radius * 1.15);
  fill.addColorStop(0, 'rgba(66, 109, 137, 0.12)');
  fill.addColorStop(0.55, 'rgba(21, 42, 68, 0.1)');
  fill.addColorStop(1, 'rgba(4, 12, 25, 0.24)');
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, TAU); ctx.fill();
  ctx.restore();
  drawGrid(ctx, camera, axes, false);
}

export function drawGlobeFront(ctx: CanvasRenderingContext2D, camera: Camera, axes: readonly SpatialPoint[]): void {
  const center = camera.worldToScreen({ x: 0, y: 0 });
  const radius = SPHERE_EXTENT * camera.state.zoom;
  ctx.save();
  const shade = ctx.createRadialGradient(center.x - radius * 0.4, center.y - radius * 0.45, radius * 0.08, center.x + radius * 0.22, center.y + radius * 0.2, radius * 1.18);
  shade.addColorStop(0, 'rgba(120, 184, 196, 0.018)');
  shade.addColorStop(0.42, 'rgba(13, 28, 48, 0.05)');
  shade.addColorStop(0.75, 'rgba(5, 14, 30, 0.16)');
  shade.addColorStop(1, 'rgba(2, 7, 16, 0.52)');
  ctx.fillStyle = shade;
  ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, TAU); ctx.fill();
  const rim = ctx.createLinearGradient(center.x - radius, center.y - radius, center.x + radius, center.y + radius);
  rim.addColorStop(0, 'rgba(151, 218, 225, 0.47)');
  rim.addColorStop(0.36, 'rgba(113, 172, 203, 0.21)');
  rim.addColorStop(0.7, 'rgba(62, 101, 146, 0.08)');
  rim.addColorStop(1, 'rgba(46, 76, 116, 0.025)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.15;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(164, 224, 226, 0.17)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(center.x, center.y, radius - 1.5, Math.PI * 1.05, Math.PI * 1.43); ctx.stroke();
  ctx.restore();
  drawGrid(ctx, camera, axes, true);
}
