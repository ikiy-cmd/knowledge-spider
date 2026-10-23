import type { GraphNode } from '../types';
import type { Camera } from '../graph/camera';
import { SPHERE_RADIUS, type Point } from '../graph/layout';

export function nodeDepth(node: GraphNode): number {
  return Math.max(0, Math.min(1, ((node.spatial?.z ?? 0) + SPHERE_RADIUS) / (SPHERE_RADIUS * 2)));
}

export function spiderBodyLength(zoom: number): number {
  return Math.max(68, Math.min(100, 82 * Math.sqrt(zoom)));
}

export function nodeScreenPosition(node: GraphNode, camera: Camera): Point {
  return camera.worldToScreen({ x: node.x, y: node.y });
}

export function nodeScreenRadius(node: GraphNode, zoom: number): number {
  const depthScale = 0.5 + nodeDepth(node) * 0.92;
  if (node.kind === 'topic') return Math.max(9, Math.min(17, 5 + zoom * 10.2)) * depthScale;
  if (node.kind === 'document') return Math.max(4, Math.min(9, 2.8 + zoom * 4.5)) * depthScale;
  return Math.max(2.5, Math.min(6, 2 + zoom * 3.1)) * depthScale;
}

export function topicTogglePosition(node: GraphNode, camera: Camera): Point {
  const screen = nodeScreenPosition(node, camera);
  const radius = nodeScreenRadius(node, camera.state.zoom);
  return { x: screen.x - radius - 13, y: screen.y - radius - 12 };
}

export function hitNode(
  nodes: GraphNode[],
  camera: Camera,
  screenPoint: Point,
): GraphNode | null {
  let best: { node: GraphNode; score: number } | null = null;
  for (const node of nodes) {
    const screen = nodeScreenPosition(node, camera);
    const radius = nodeScreenRadius(node, camera.state.zoom);
    const distance = Math.hypot(screen.x - screenPoint.x, screen.y - screenPoint.y);
    const threshold = Math.max(10, radius + 8);
    if (distance <= threshold) {
      const score = distance / threshold + (1 - nodeDepth(node)) * 0.2;
      if (!best || score < best.score) best = { node, score };
    }
  }
  return best?.node ?? null;
}

export function hitTopicToggle(
  nodes: GraphNode[],
  camera: Camera,
  screenPoint: Point,
): GraphNode | null {
  for (const node of nodes) {
    if (node.kind !== 'topic') continue;
    const toggle = topicTogglePosition(node, camera);
    if (Math.hypot(toggle.x - screenPoint.x, toggle.y - screenPoint.y) <= 11) {
      return node;
    }
  }
  return null;
}

export function hitSpiderBody(camera: Camera, body: Point, screenPoint: Point): boolean {
  const screen = camera.worldToScreen(body);
  return Math.hypot(screen.x - screenPoint.x, screen.y - screenPoint.y) < spiderBodyLength(camera.state.zoom) * 0.56;
}
