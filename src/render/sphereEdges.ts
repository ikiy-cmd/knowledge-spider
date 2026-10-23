import type { GraphEdge, GraphModel, GraphNode } from '../types';
import type { Camera } from '../graph/camera';
import { SPHERE_RADIUS, projectSpatial, sampleSphereArc, type SpatialPoint } from '../graph/sphere';

interface ArcPoint { x: number; y: number; z: number }
interface CachedArc { coordinates: number[]; points: ArcPoint[] }
const arcCache = new WeakMap<GraphEdge, CachedArc>();

function edgeArc(edge: GraphEdge, source: GraphNode, target: GraphNode): ArcPoint[] {
  const a: SpatialPoint = source.spatial ?? { x: source.x, y: source.y, z: 0 };
  const b: SpatialPoint = target.spatial ?? { x: target.x, y: target.y, z: 0 };
  const coordinates = [a.x, a.y, a.z, b.x, b.y, b.z];
  const cached = arcCache.get(edge);
  if (cached && cached.coordinates.every((value, index) => value === coordinates[index])) return cached.points;
  const points = sampleSphereArc(a, b).map(point => ({ ...projectSpatial(point), z: point.z }));
  arcCache.set(edge, { coordinates, points });
  return points;
}

export function drawSphereEdges(ctx: CanvasRenderingContext2D, graph: GraphModel, camera: Camera, visibleMap: Map<string, GraphNode>, focusId: string | null, front: boolean): void {
  const firstBand = front ? 2 : 0;
  for (const edge of graph.edges) {
    const source = visibleMap.get(edge.source);
    const target = visibleMap.get(edge.target);
    if (!source || !target) continue;
    const points = edgeArc(edge, source, target);
    const direct = focusId === source.id || focusId === target.id;
    const contains = edge.kind === 'contains';
    ctx.save();
    ctx.strokeStyle = direct ? edge.kind === 'citation' ? '#F2D295' : source.color : contains ? '#B1CCD5' : '#849FBC';
    if (edge.kind === 'similarity') ctx.setLineDash([1.5, 4]);
    for (let band = firstBand; band < firstBand + 2; band++) {
      const alpha = [0.045, 0.095, 0.2, 0.37][band];
      ctx.globalAlpha = direct ? Math.min(0.8, alpha * 1.7 + 0.15) : alpha * (focusId ? 0.25 : 1) * (contains ? 1 : 0.64);
      ctx.lineWidth = (direct ? 1.35 : 0.55) + band * 0.18;
      ctx.beginPath();
      let drawn = false;
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        const depth = ((a.z + b.z) / 2 + SPHERE_RADIUS) / (SPHERE_RADIUS * 2);
        if (Math.min(3, Math.max(0, Math.floor(depth * 4))) !== band) continue;
        const p = camera.worldToScreen(a);
        const q = camera.worldToScreen(b);
        ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
        drawn = true;
      }
      if (drawn) ctx.stroke();
    }
    ctx.restore();
  }
}
