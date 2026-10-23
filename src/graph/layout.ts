import type { GraphModel, GraphNode } from '../types';
import { SPHERE_RADIUS, VIEW_DISTANCE, SPHERE_EXTENT, projectSpatial, rotateSpatialPoint } from './sphere';
export { SPHERE_RADIUS, VIEW_DISTANCE, SPHERE_EXTENT, projectSpatial, rotateSpatialPoint, sampleSphereArc, transformSpatial, type SpatialPoint } from './sphere';

export interface Point {
  x: number;
  y: number;
  spatial?: { x: number; y: number; z: number };
}

const CLUSTER_RADIUS = 1000;

export const TOPIC_CENTERS: Record<string, Point> = {
  't-retrieval': { x: -330, y: -100 },
  't-modeling': { x: -110, y: -340 },
  't-agents': { x: -230, y: 290 },
  't-collab': { x: 250, y: 300 },
  't-governance': { x: 345, y: -120 },
};

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function projectNode(node: GraphNode): void {
  if (!node.spatial) return;
  const projected = projectSpatial(node.spatial);
  node.x = projected.x;
  node.y = projected.y;
}

function syncTopics(graph: GraphModel): void {
  for (const topic of graph.topics) {
    const node = graph.byId.get(topic.id);
    if (node) { topic.x = node.x; topic.y = node.y; }
  }
}

export interface LayoutOptions { preserve?: Map<string, Point> }

export function layoutGraph(graph: GraphModel, options: LayoutOptions = {}): void {
  const members = graph.nodes.filter((node) => node.kind !== 'topic');
  for (const node of graph.nodes) {
    const preserved = options.preserve?.get(node.id);
    if (preserved) {
      node.x = preserved.x;
      node.y = preserved.y;
      node.spatial = preserved.spatial ? { ...preserved.spatial } : { x: node.x, y: node.y, z: 0 };
      continue;
    }
    const fixed = node.kind === 'topic' ? TOPIC_CENTERS[node.id] : undefined;
    if (fixed) {
      node.spatial = { x: fixed.x, y: fixed.y, z: Math.sqrt(SPHERE_RADIUS ** 2 - fixed.x ** 2 - fixed.y ** 2) };
    } else {
      // Golden-angle sampling fills both hemispheres using actual knowledge nodes.
      const slot = node.kind === 'topic' ? hashString(node.id) % Math.max(1, members.length) : members.indexOf(node);
      const y = 1 - (2 * (slot + 0.5)) / Math.max(1, members.length);
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = slot * Math.PI * (3 - Math.sqrt(5)) + 0.6;
      const radius = node.kind === 'topic' ? SPHERE_RADIUS : SPHERE_RADIUS * (0.76 + (hashString(node.id) % 1000) / 1000 * 0.24);
      node.spatial = {
        x: Math.cos(angle) * ring * radius,
        y: y * radius,
        z: Math.sin(angle) * ring * radius,
      };
    }
    projectNode(node);
  }
  syncTopics(graph);
}

export function rotateGraph(graph: GraphModel, yaw: number, pitch: number): void {
  for (const node of graph.nodes) {
    const point = node.spatial;
    if (!point) continue;
    node.spatial = rotateSpatialPoint(point, yaw, pitch);
    projectNode(node);
  }
  syncTopics(graph);
}

export function syncSpatialPosition(node: GraphNode): void {
  // Keep edits inside the camera plane at every possible orbit angle.
  const maxRadius = SPHERE_RADIUS * 2;
  const z = clamp(node.spatial?.z ?? 0, -maxRadius, maxRadius);
  const perspective = VIEW_DISTANCE / (VIEW_DISTANCE - z);
  const x = node.x / perspective;
  const y = node.y / perspective;
  const length = Math.hypot(x, y);
  const planarLimit = Math.sqrt(Math.max(0, maxRadius ** 2 - z ** 2));
  const scale = length > planarLimit ? planarLimit / length : 1;
  node.spatial = { x: x * scale, y: y * scale, z };
  projectNode(node);
}

export function graphBounds(graph: GraphModel): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!graph.nodes.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(-SPHERE_EXTENT, ...graph.nodes.map((node) => node.x)),
    minY: Math.min(-SPHERE_EXTENT, ...graph.nodes.map((node) => node.y)),
    maxX: Math.max(SPHERE_EXTENT, ...graph.nodes.map((node) => node.x)),
    maxY: Math.max(SPHERE_EXTENT, ...graph.nodes.map((node) => node.y)),
  };
}

export function snapshotPositions(graph: GraphModel): Map<string, Point> {
  return new Map(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y, spatial: node.spatial ? { ...node.spatial } : undefined }]));
}

export function topicCenter(graph: GraphModel, topicId: string): Point {
  const topic = graph.topics.find((entry) => entry.id === topicId);
  return topic ? { x: topic.x, y: topic.y } : { x: 0, y: 0 };
}

export function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

export function clampToCluster(center: Point, point: Point): Point {
  const length = distance(center, point);
  if (length <= CLUSTER_RADIUS) return point;
  return { x: center.x + ((point.x - center.x) / length) * CLUSTER_RADIUS, y: center.y + ((point.y - center.y) / length) * CLUSTER_RADIUS };
}

export { CLUSTER_RADIUS };
