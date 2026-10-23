import type { GraphModel, GraphNode, MotionPhase, SearchSnapshot } from '../types';
import type { Camera } from '../graph/camera';
import type { Point, SpatialPoint } from '../graph/layout';
import { drawGlobeBack, drawGlobeFront } from './globe';
import { drawSphereEdges } from './sphereEdges';
import type { LegState, Spider } from '../spider/Spider';
import { nodeDepth, nodeScreenPosition, nodeScreenRadius, spiderBodyLength, topicTogglePosition } from './hit';

export interface SceneState {
  graph: GraphModel;
  camera: Camera;
  sphereAxes: readonly SpatialPoint[];
  spider: Spider;
  selectedId: string | null;
  targetId: string | null;
  hoverId: string | null;
  collapsedTopics: Set<string>;
  snapshot: SearchSnapshot | null;
  routeIds: string[];
  visitedEvidenceIds: string[];
  currentEvidenceId: string | null;
  manualVisitedIds: string[];
  phase: MotionPhase;
  mode: 'manual' | 'auto';
  paused: boolean;
  reducedMotion: boolean;
  time: number;
  width: number;
  height: number;
}

const TAU = Math.PI * 2;
const FONT_UI = '"Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif';
const FONT_MONO = '"IBM Plex Mono", "Cascadia Mono", Consolas, monospace';
const ACCENT = '#B9EAD8';
const GOLD = '#F2D295';

const glowCache = new Map<string, HTMLCanvasElement>();

function rgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const normalized =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean;
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return `rgba(180, 230, 216, ${alpha})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getGlowSprite(color: string): HTMLCanvasElement {
  const cached = glowCache.get(color);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    gradient.addColorStop(0, rgba(color, 0.6));
    gradient.addColorStop(0.28, rgba(color, 0.2));
    gradient.addColorStop(0.65, rgba(color, 0.045));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
  }
  glowCache.set(color, canvas);
  return canvas;
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  const sprite = getGlowSprite(color);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function pointInViewport(point: Point, width: number, height: number, pad = 80): boolean {
  return point.x > -pad && point.x < width + pad && point.y > -pad && point.y < height + pad;
}

interface SceneContext {
  focusId: string | null;
  neighborIds: Set<string>;
  visibleNodes: GraphNode[];
  visibleMap: Map<string, GraphNode>;
  hiddenByTopic: Set<string>;
  zoom: number;
  evidenceRanks: Map<string, number>;
  candidateIds: Set<string>;
  visitedEvidence: Set<string>;
  currentEvidenceId: string | null;
}

function prepareScene(state: SceneState): SceneContext {
  const hiddenByTopic = new Set(state.collapsedTopics);
  const visibleNodes = state.graph.nodes.filter(
    (node) => node.kind === 'topic' || !hiddenByTopic.has(node.topicId),
  ).sort((a, b) => nodeDepth(a) - nodeDepth(b));
  const visibleMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const focusId = state.selectedId ?? state.targetId ?? null;
  const neighborIds = new Set<string>();
  if (focusId && visibleMap.has(focusId)) {
    neighborIds.add(focusId);
    for (const edge of state.graph.edges) {
      if (edge.source === focusId && visibleMap.has(edge.target)) neighborIds.add(edge.target);
      if (edge.target === focusId && visibleMap.has(edge.source)) neighborIds.add(edge.source);
    }
  }
  const evidenceRanks = new Map<string, number>();
  for (const hit of state.snapshot?.hits ?? []) evidenceRanks.set(hit.fragmentId, hit.rank);
  return {
    focusId,
    neighborIds,
    visibleNodes,
    visibleMap,
    hiddenByTopic,
    zoom: state.camera.state.zoom,
    evidenceRanks,
    candidateIds: new Set(state.snapshot?.candidateIds ?? []),
    visitedEvidence: new Set(state.visitedEvidenceIds),
    currentEvidenceId: state.currentEvidenceId,
  };
}

function nodeOpacity(node: GraphNode, scene: SceneContext): number {
  const depth = 0.12 + Math.pow(nodeDepth(node), 1.6) * 0.88;
  if (!scene.focusId || scene.neighborIds.has(node.id)) return depth;
  if (node.kind === 'topic') return Math.max(0.42, depth);
  return depth * 0.32;
}

function drawDemoRoute(ctx: CanvasRenderingContext2D, state: SceneState, scene: SceneContext): void {
  if (!state.snapshot || !state.routeIds.length) return;
  const points = state.routeIds
    .map((id) => scene.visibleMap.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .map((node) => nodeScreenPosition(node, state.camera));
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = rgba(GOLD, state.mode === 'auto' ? 0.26 : 0.13);
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 8]);
  ctx.lineDashOffset = state.paused ? 0 : -(state.time * 11) % 10;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const midX = (previous.x + current.x) / 2;
    const midY = (previous.y + current.y) / 2;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const bend = Math.min(50, length * 0.12) * (i % 2 === 0 ? 1 : -1);
    ctx.quadraticCurveTo(
      midX - (dy / length) * bend,
      midY + (dx / length) * bend,
      current.x,
      current.y,
    );
  }
  ctx.stroke();
  ctx.restore();
}

function drawNodeGlow(ctx: CanvasRenderingContext2D, node: GraphNode, screen: Point, zoom: number, alpha: number): void {
  const glowScale = Math.max(0.8, Math.min(1.2, zoom));
  if (node.kind === 'topic') {
    drawGlow(ctx, node.color, screen.x, screen.y, 76, 0.4 * alpha);
    drawGlow(ctx, node.color, screen.x, screen.y, 40, 0.55 * alpha);
  } else if (node.kind === 'document') {
    drawGlow(ctx, node.color, screen.x, screen.y, 34, 0.24 * alpha);
  } else {
    drawGlow(ctx, node.color, screen.x, screen.y, 24 * glowScale, 0.3 * alpha);
    drawGlow(ctx, node.color, screen.x, screen.y, 12, 0.5 * alpha);

  }
}

function drawNodeMark(ctx: CanvasRenderingContext2D, node: GraphNode, screen: Point, state: SceneState, scene: SceneContext): void {
  const impact = state.reducedMotion ? 0 : state.spider.legs.reduce((value, leg) => {
    const age = state.time - leg.contactAt;
    return leg.contactNodeId === node.id && age >= 0 && age < 0.32 ? Math.max(value, Math.sin((age / 0.32) * Math.PI) * 0.2) : value;
  }, 0);
  const radius = nodeScreenRadius(node, state.camera.state.zoom) * (1 + impact);
  const dim = nodeOpacity(node, scene);
  ctx.save();
  ctx.globalAlpha = dim;
  drawNodeGlow(ctx, node, screen, scene.zoom, dim);

  if (node.kind === 'topic') {
    ctx.strokeStyle = rgba(node.color, 0.3);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius + 4.5, 0, TAU);
    ctx.stroke();
    const gradient = ctx.createRadialGradient(
      screen.x - radius * 0.3,
      screen.y - radius * 0.35,
      0,
      screen.x,
      screen.y,
      radius,
    );
    gradient.addColorStop(0, '#F8FFFC');
    gradient.addColorStop(0.3, node.color);
    gradient.addColorStop(1, rgba(node.color, 0.68));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(5, 11, 14, 0.6)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.beginPath();
    ctx.arc(screen.x - radius * 0.24, screen.y - radius * 0.28, Math.max(0.8, radius * 0.13), 0, TAU);
    ctx.fill();
  } else if (node.kind === 'document') {
    const size = radius + 1.8;
    ctx.translate(screen.x, screen.y);
    ctx.rotate(Math.PI / 4);
    roundedRect(ctx, -size / 2, -size / 2, size, size, 1.4);
    const facet = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    facet.addColorStop(0, '#E0F8FF');
    facet.addColorStop(0.32, node.color);
    facet.addColorStop(1, '#24394C');
    ctx.fillStyle = facet;
    ctx.fill();
    ctx.strokeStyle = rgba(node.color, 0.92);
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = rgba(node.color, 0.75);
    ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
  } else {
    ctx.fillStyle = 'rgba(8, 14, 17, 0.88)';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius + 1.6, 0, TAU);
    ctx.fill();
    const pearl = ctx.createRadialGradient(screen.x - radius * 0.35, screen.y - radius * 0.4, 0, screen.x, screen.y, radius);
    pearl.addColorStop(0, '#E7FBFF');
    pearl.addColorStop(0.3, node.color);
    pearl.addColorStop(1, rgba(node.color, 0.4));
    ctx.fillStyle = pearl;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, Math.max(1, radius - 0.3), 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(node.color, 0.75);
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius + 0.8, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNodeStates(ctx: CanvasRenderingContext2D, state: SceneState, scene: SceneContext): void {
  const pulse = state.reducedMotion ? 0.5 : (Math.sin(state.time * 2.4) + 1) / 2;
  for (const node of scene.visibleNodes) {
    const screen = nodeScreenPosition(node, state.camera);
    if (!pointInViewport(screen, state.width, state.height, 60)) continue;
    const radius = nodeScreenRadius(node, state.camera.state.zoom);
    const dim = nodeOpacity(node, scene);
    const isSelected = state.selectedId === node.id;
    const isTarget = state.targetId === node.id;
    const isHover = state.hoverId === node.id;
    const isCandidate = node.kind === 'fragment' && scene.candidateIds.has(node.id);
    const rank = node.kind === 'fragment' ? scene.evidenceRanks.get(node.id) : undefined;
    const isVisited = scene.visitedEvidence.has(node.id);
    const isCurrent = scene.currentEvidenceId === node.id;
    const isManualVisited = state.manualVisitedIds.includes(node.id);

    ctx.save();
    if (node.kind !== 'topic' && isCandidate && !rank) {
      ctx.globalAlpha = 0.36 * dim;
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 0.7;
      ctx.setLineDash([1.6, 3.2]);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 6.5, 0, TAU);
      ctx.stroke();
    }

    if (rank) {
      ctx.globalAlpha = 0.9 * dim;
      ctx.strokeStyle = rgba(GOLD, isCurrent ? 0.95 : 0.72);
      ctx.lineWidth = isCurrent ? 1.4 : 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 7.5 + (isCurrent ? pulse * 2 : 0), 0, TAU);
      ctx.stroke();
      if (isVisited && !isCurrent) {
        ctx.globalAlpha = 0.55 * dim;
        ctx.strokeStyle = rgba(GOLD, 0.6);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius + 11, 0, TAU);
        ctx.stroke();
      }
    }

    if (isManualVisited && !rank && !isSelected && !isTarget) {
      ctx.globalAlpha = 0.36 * dim;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 0.6;
      ctx.setLineDash([1, 4]);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 4.5, 0, TAU);
      ctx.stroke();
    }

    if (isSelected || isTarget) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = rgba(ACCENT, isTarget && state.phase === 'traveling' ? 0.72 + pulse * 0.2 : 0.8);
      ctx.lineWidth = 0.9;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 10 + pulse * 2.2, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.24;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 16 + pulse * 4, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.88;
      const arcStart = state.time * 0.55;
      ctx.strokeStyle = rgba(ACCENT, 0.72);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 13, arcStart, arcStart + Math.PI * 0.55);
      ctx.stroke();
    }

    if (isHover && !isSelected && !isTarget) {
      ctx.globalAlpha = 0.72 * dim;
      ctx.strokeStyle = 'rgba(226, 246, 239, 0.58)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 7, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawNodes(ctx: CanvasRenderingContext2D, state: SceneState, scene: SceneContext, front: boolean): void {
  for (const node of scene.visibleNodes) {
    if ((nodeDepth(node) >= 0.5) !== front) continue;
    const screen = nodeScreenPosition(node, state.camera);
    if (!pointInViewport(screen, state.width, state.height, 70)) continue;
    drawNodeMark(ctx, node, screen, state, scene);
  }
}

function bezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  };
}

interface LegCurve {
  root: Point;
  foot: Point;
  controlA: Point;
  controlB: Point;
  lift: number;
}

function legCurve(leg: LegState, state: SceneState): LegCurve {
  const footWorld = state.spider.getFootWorld(leg);
  const footBase = state.camera.worldToScreen(footWorld);
  const lift = state.spider.getSwingLift(leg);
  const foot = { x: footBase.x, y: footBase.y - lift };
  const bodyScreen = state.camera.worldToScreen(state.spider.body);
  const bodyLength = spiderBodyLength(state.camera.state.zoom) * 0.75;
  const visualScale = bodyLength / 19;
  const forward = { x: Math.cos(state.spider.heading), y: Math.sin(state.spider.heading) };
  const right = { x: -forward.y, y: forward.x };
  const root = {
    x:
      bodyScreen.x +
      forward.x * leg.spec.rootForward * visualScale +
      right.x * leg.spec.side * leg.spec.rootLateral * visualScale,
    y:
      bodyScreen.y +
      forward.y * leg.spec.rootForward * visualScale +
      right.y * leg.spec.side * leg.spec.rootLateral * visualScale,
  };
  const outwardRaw = { x: root.x - bodyScreen.x, y: root.y - bodyScreen.y };
  const outLen = Math.hypot(outwardRaw.x, outwardRaw.y) || 1;
  const outward = { x: outwardRaw.x / outLen, y: outwardRaw.y / outLen };
  const naturalAngle = state.spider.heading + leg.spec.naturalAngle;
  const natural = { x: Math.cos(naturalAngle), y: Math.sin(naturalAngle) };
  const dx = foot.x - root.x;
  const dy = foot.y - root.y;
  const length = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / length, y: dy / length };
  const bow = Math.min(62, 26 + length * 0.27);
  const endBow = Math.min(34, 12 + length * 0.14);
  const stretch = Math.max(0, Math.min(1, (leg.extension - 0.6) / 0.92));
  const phase = state.time * 4.2 + leg.spec.naturalAngle * 2.5;
  const moving = Boolean(leg.swing) || state.spider.mode === 'traveling';
  const wave = state.reducedMotion ? 0 : Math.sin(phase) * (moving ? 12 : 3) * (1 - stretch * 0.8);
  const slack = 1.4 - stretch * 0.8;
  const controlA = {
    x: root.x + dir.x * length * 0.24 + natural.x * Math.min(28, length * 0.14) + outward.x * bow * 0.48 * slack - dir.y * wave,
    y: root.y + dir.y * length * 0.24 + natural.y * Math.min(28, length * 0.14) + outward.y * bow * 0.48 * slack - lift * 0.26 + dir.x * wave,
  };
  const controlB = {
    x: foot.x - dir.x * length * 0.19 + outward.x * endBow * slack + dir.y * wave * 0.55,
    y: foot.y - dir.y * length * 0.19 + outward.y * endBow * slack - lift * 0.46 - dir.x * wave * 0.55,
  };
  return { root, foot, controlA, controlB, lift };
}

function drawContacts(ctx: CanvasRenderingContext2D, state: SceneState, scene: SceneContext): void {
  for (const leg of state.spider.legs) {
    const age = state.time - leg.contactAt;
    if (!leg.contactNodeId || age < 0 || age > 0.95) continue;
    const node = scene.visibleMap.get(leg.contactNodeId);
    if (!node) continue;
    const point = nodeScreenPosition(node, state.camera);
    const radius = nodeScreenRadius(node, scene.zoom);
    const reading = leg.spec.id === state.spider.readingLegId && state.spider.targetNodeId === node.id;
    const color = reading ? GOLD : node.color;
    ctx.save();
    drawGlow(ctx, color, point.x, point.y, 60, (1 - age / 0.95) * 0.85);
    for (let ring = 0; ring < 2; ring += 1) {
      const progress = (age - ring * 0.14) / 0.78;
      if (progress < 0 || progress > 1) continue;
      ctx.strokeStyle = rgba(color, (1 - progress) ** 1.4 * 0.9);
      ctx.lineWidth = 1.7 - progress * 0.7;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 4 + (state.reducedMotion ? 3 : (1 - (1 - progress) ** 2) * 26), 0, TAU);
      ctx.stroke();
    }
    if (age < 0.24 && !state.reducedMotion) {
      ctx.strokeStyle = rgba('#EDFFF7', (1 - age / 0.24) * 0.9);
      ctx.lineWidth = 1.2;
      for (let ray = 0; ray < 6; ray += 1) {
        const angle = ray * TAU / 6;
        const start = radius + 5 + age * 16;
        ctx.beginPath();
        ctx.moveTo(point.x + Math.cos(angle) * start, point.y + Math.sin(angle) * start);
        ctx.lineTo(point.x + Math.cos(angle) * (start + 5), point.y + Math.sin(angle) * (start + 5));
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function drawSpider(ctx: CanvasRenderingContext2D, state: SceneState): void {
  const { spider } = state;
  if (!spider.bodyNodes.length) return;
  const bodyScreen = state.camera.worldToScreen(spider.body);
  if (!pointInViewport(bodyScreen, state.width, state.height, 240)) return;
  const readingLeg = spider.legs.find((leg) => leg.spec.id === spider.readingLegId) ?? null;
  const readingActive =
    spider.readActive && Boolean(readingLeg && spider.targetNodeId && readingLeg.anchorId === spider.targetNodeId);

  for (const leg of spider.legs) {
    if (leg.anchorId) {
      const node = spider.getNode(leg.anchorId);
      if (!node) continue;
      const screen = state.camera.worldToScreen({ x: node.x, y: node.y });
      const isReading = readingActive && leg.spec.id === spider.readingLegId;
      ctx.save();
      ctx.globalAlpha = isReading ? 0.72 : 0.25;
      ctx.strokeStyle = isReading ? '#F4DDA3' : ACCENT;
      ctx.lineWidth = isReading ? 1 : 0.7;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, isReading ? 7 + Math.sin(state.time * 4) * 1.2 : 4.5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  const legOrder = ['L4', 'R4', 'L3', 'R3', 'L2', 'R2', 'L1', 'R1'];
  const orderedLegs = [...spider.legs].sort(
    (a, b) => legOrder.indexOf(a.spec.id) - legOrder.indexOf(b.spec.id),
  );

  for (const leg of orderedLegs) {
    const curve = legCurve(leg, state);
    const isReading = readingActive && leg.spec.id === spider.readingLegId;
    const swinging = Boolean(leg.swing);
    const moving = spider.mode === 'traveling' || spider.mode === 'settling';
    const swingProgress = spider.getSwingProgress(leg);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // A quiet dark trace separates the luminous limbs from the busy web.
    ctx.strokeStyle = 'rgba(3, 8, 10, 0.62)';
    ctx.lineWidth = isReading ? 7 : 6;
    ctx.beginPath();
    ctx.moveTo(curve.root.x, curve.root.y);
    ctx.bezierCurveTo(
      curve.controlA.x,
      curve.controlA.y,
      curve.controlB.x,
      curve.controlB.y,
      curve.foot.x,
      curve.foot.y,
    );
    ctx.stroke();

    if (isReading) {
      ctx.strokeStyle = 'rgba(240, 207, 150, 0.19)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(curve.root.x, curve.root.y);
      ctx.bezierCurveTo(
        curve.controlA.x,
        curve.controlA.y,
        curve.controlB.x,
        curve.controlB.y,
        curve.foot.x,
        curve.foot.y,
      );
      ctx.stroke();
    }

    const limbGradient = ctx.createLinearGradient(curve.root.x, curve.root.y, curve.foot.x, curve.foot.y);
    limbGradient.addColorStop(0, isReading ? '#FFEDC2' : '#D8FAED');
    limbGradient.addColorStop(0.38, isReading ? '#CEAC69' : '#75AFA9');
    limbGradient.addColorStop(1, isReading ? '#F4D69B' : 'rgba(137, 185, 186, 0.6)');
    ctx.strokeStyle = limbGradient;
    ctx.globalAlpha = swinging ? 0.66 : 0.96;
    ctx.lineWidth = isReading ? 3.4 : moving ? 2.2 : 2.7;
    ctx.beginPath();
    ctx.moveTo(curve.root.x, curve.root.y);
    ctx.bezierCurveTo(
      curve.controlA.x,
      curve.controlA.y,
      curve.controlB.x,
      curve.controlB.y,
      curve.foot.x,
      curve.foot.y,
    );
    ctx.stroke();

    const joint = bezierPoint(curve.root, curve.controlA, curve.controlB, curve.foot, 0.37);
    ctx.fillStyle = '#9DD3C5';
    ctx.strokeStyle = '#203C43';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(joint.x, joint.y, 2.8, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(225, 255, 246, 0.86)';
    ctx.beginPath();
    ctx.arc(curve.root.x, curve.root.y, 1.15, 0, TAU);
    ctx.fill();

    if (leg.anchorId) {
      ctx.fillStyle = isReading ? '#FFF1C9' : 'rgba(230, 251, 244, 0.96)';
      ctx.beginPath();
      ctx.arc(curve.foot.x, curve.foot.y, isReading ? 2.15 : 1.55, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = isReading ? 'rgba(255, 238, 194, 0.8)' : 'rgba(205, 240, 230, 0.36)';
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.arc(curve.foot.x, curve.foot.y, isReading ? 5 : 3, 0, TAU);
      ctx.stroke();
    } else if (swinging) {
      const liftAlpha = Math.sin(Math.PI * swingProgress);
      ctx.globalAlpha = 0.34 + liftAlpha * 0.5;
      ctx.fillStyle = 'rgba(238, 253, 247, 0.98)';
      ctx.beginPath();
      ctx.arc(curve.foot.x, curve.foot.y, 1.25 + liftAlpha * 0.3, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.13 + liftAlpha * 0.1;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 0.55;
      ctx.setLineDash([0.8, 2.2]);
      ctx.beginPath();
      ctx.moveTo(curve.foot.x, curve.foot.y + 8);
      ctx.lineTo(curve.foot.x, curve.foot.y + 1.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (readingActive && readingLeg) {
    const curve = legCurve(readingLeg, state);
    const pulses = state.reducedMotion ? 2 : 4;
    for (let index = 0; index < pulses; index += 1) {
      const offset = index / pulses;
      const progress = ((spider.simTime * 0.55 + offset) % 1 + 1) % 1;
      const t = 1 - progress;
      const point = bezierPoint(curve.root, curve.controlA, curve.controlB, curve.foot, t);
      const alpha = 0.2 + Math.sin(progress * Math.PI) * 0.7;
      drawGlow(ctx, GOLD, point.x, point.y, 14, alpha * 0.65);
      ctx.save();
      ctx.fillStyle = `rgba(255, 239, 199, ${alpha})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawSpiderBody(ctx, state, bodyScreen);
}

function drawSpiderBody(ctx: CanvasRenderingContext2D, state: SceneState, center: Point): void {
  const length = spiderBodyLength(state.camera.state.zoom);
  const reading = state.spider.readActive;
  ctx.save();
  drawGlow(ctx, '#97DCCB', center.x, center.y, length * 1.8, 0.2);
  ctx.translate(center.x, center.y);
  ctx.rotate(state.spider.heading);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 9;
  const shell = (x: number, rx: number, ry: number) => {
    const gradient = ctx.createRadialGradient(x - rx * 0.3, -ry * 0.55, 0, x + rx * 0.15, ry * 0.15, rx * 1.4);
    gradient.addColorStop(0, '#E1FFF1');
    gradient.addColorStop(0.18, '#A7D9C7');
    gradient.addColorStop(0.46, '#507F7B');
    gradient.addColorStop(0.76, '#203C44');
    gradient.addColorStop(1, '#09151F');
    ctx.fillStyle = gradient;
    ctx.strokeStyle = 'rgba(187, 244, 222, 0.62)';
    ctx.lineWidth = 1.15;
    ctx.beginPath(); ctx.ellipse(x, 0, rx, ry, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(232, 255, 245, 0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x - rx * 0.1, -ry * 0.15, rx * 0.82, ry * 0.75, 0, Math.PI * 1.04, Math.PI * 1.8); ctx.stroke();
  };
  ctx.strokeStyle = '#8ABBB0'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(-length * 0.32, 0); ctx.lineTo(length * 0.38, 0); ctx.stroke();
  shell(-length * 0.24, length * 0.32, length * 0.23);
  // Three inset plates pick up the light across the abdomen.
  ctx.strokeStyle = 'rgba(8, 23, 31, 0.35)'; ctx.lineWidth = 1.3;
  for (const offset of [-0.37, -0.25, -0.13]) {
    ctx.beginPath();
    ctx.moveTo(length * offset, -length * 0.18);
    ctx.quadraticCurveTo(length * (offset + 0.13), 0, length * offset, length * 0.18);
    ctx.stroke();
  }
  shell(length * 0.13, length * 0.22, length * 0.175);
  shell(length * 0.39, length * 0.14, length * 0.13);
  ctx.fillStyle = reading ? '#FFE8A8' : '#C8FFE7';
  ctx.shadowColor = reading ? '#FFE8A8' : '#ABFFDE'; ctx.shadowBlur = 9;
  ctx.beginPath(); ctx.ellipse(length * 0.12, 0, length * 0.07, length * 0.035, 0, 0, TAU); ctx.fill();
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.arc(length * 0.47, side * length * 0.062, 2.35, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(178, 232, 213, 0.85)'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(length * 0.45, side * length * 0.11);
    ctx.quadraticCurveTo(length * 0.62, side * length * 0.22, length * 0.59, side * length * 0.05);
    ctx.stroke();
  }
  ctx.restore();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

interface LabelRequest {
  node: GraphNode;
  priority: number;
  font: string;
  title: string;
  meta: string | null;
  width: number;
  height: number;
  accent: string;
  highlighted: boolean;
}

interface PlacedLabel {
  x: number;
  y: number;
  width: number;
  height: number;
}

function buildLabelRequests(ctx: CanvasRenderingContext2D, state: SceneState, scene: SceneContext): LabelRequest[] {
  const labels: LabelRequest[] = [];
  for (const node of scene.visibleNodes) {
    const isSelected = state.selectedId === node.id;
    const isTarget = state.targetId === node.id;
    const isHover = state.hoverId === node.id;
    const isCurrentEvidence = state.currentEvidenceId === node.id;
    const relevant = isSelected || isTarget || isHover || isCurrentEvidence;
    let visible = false;
    if (node.kind === 'topic') visible = true;
    else if (node.kind === 'document') visible = relevant || (scene.zoom >= 0.46 && nodeDepth(node) > 0.56);
    else visible = relevant || (scene.zoom > 0.5 && nodeDepth(node) > 0.94);
    if (!visible) continue;
    if (state.collapsedTopics.has(node.topicId) && node.kind !== 'topic') continue;

    const topic = state.graph.topics.find((entry) => entry.id === node.topicId);
    let font = `500 15px ${FONT_UI}`;
    let title = node.title;
    let meta: string | null = null;
    let maxWidth = 216;
    if (node.kind === 'topic') {
      font = `600 ${state.width < 720 ? 17 : 20}px ${FONT_UI}`;
      const docCount = state.graph.nodes.filter(
        (entry) => entry.topicId === node.id && entry.kind === 'document',
      ).length;
      const fragmentCount = state.graph.nodes.filter(
        (entry) => entry.topicId === node.id && entry.kind === 'fragment',
      ).length;
      meta = state.collapsedTopics.has(node.id)
        ? `${docCount} 篇 · 已收拢`
        : `${docCount} 篇 · ${fragmentCount} 段`;
      maxWidth = 238;
    } else if (node.kind === 'document') {
      font = `500 15px ${FONT_UI}`;
      meta = null;
    } else {
      font = `500 14px ${FONT_UI}`;
      meta = null;
    }
    ctx.font = font;
    title = truncateText(ctx, title, maxWidth);
    const titleWidth = ctx.measureText(title).width;
    let metaWidth = 0;
    if (meta) {
      ctx.font = `400 12px ${FONT_UI}`;
      metaWidth = ctx.measureText(meta).width;
    }
    const width = Math.ceil(Math.max(titleWidth, metaWidth)) + 32;
    const height = meta ? 48 : 30;
    const highlighted = isSelected || isTarget || isHover;
    const priority = isHover
      ? 100
      : isSelected
        ? 95
        : state.currentEvidenceId === node.id
          ? 90
          : isTarget
            ? 85
            : node.kind === 'topic'
              ? 65
              : 40;
    labels.push({
      node,
      priority,
      font,
      title,
      meta,
      width,
      height,
      accent: topic?.color ?? node.color,
      highlighted,
    });
  }
  return labels.sort((a, b) => b.priority - a.priority);
}

function drawLabels(ctx: CanvasRenderingContext2D, state: SceneState, scene: SceneContext): void {
  const labels = buildLabelRequests(ctx, state, scene);
  const body = state.camera.worldToScreen(state.spider.body);
  const bodySize = spiderBodyLength(scene.zoom);
  const placed: PlacedLabel[] = [
    { x: body.x - bodySize * 0.7, y: body.y - bodySize * 0.7, width: bodySize * 1.4, height: bodySize * 1.4 },
  ];
  const pad = 8;

  for (const label of labels) {
    const nodeScreen = nodeScreenPosition(label.node, state.camera);
    if (!pointInViewport(nodeScreen, state.width, state.height, 30)) continue;
    const radius = nodeScreenRadius(label.node, state.camera.state.zoom);
    const gap = 7;
    const candidates = [
      { x: nodeScreen.x + radius + gap, y: nodeScreen.y - label.height / 2 },
      { x: nodeScreen.x - radius - gap - label.width, y: nodeScreen.y - label.height / 2 },
      { x: nodeScreen.x - label.width / 2, y: nodeScreen.y + radius + gap },
      { x: nodeScreen.x - label.width / 2, y: nodeScreen.y - radius - gap - label.height },
    ];

    let chosen: PlacedLabel | null = null;
    for (const candidate of candidates) {
      const rect = {
        x: Math.round(Math.max(pad, Math.min(state.width - label.width - pad, candidate.x))),
        y: Math.round(Math.max(pad, Math.min(state.height - label.height - pad, candidate.y))),
        width: label.width,
        height: label.height,
      };
      const overlaps = placed.some(
        (other) =>
          rect.x < other.x + other.width + 4 &&
          rect.x + rect.width + 4 > other.x &&
          rect.y < other.y + other.height + 4 &&
          rect.y + rect.height + 4 > other.y,
      );
      if (!overlaps) {
        chosen = rect;
        break;
      }
    }
    if (!chosen) {
      if (label.priority < 80) continue;
      const candidate = candidates[0];
      chosen = {
        x: Math.round(Math.max(pad, Math.min(state.width - label.width - pad, candidate.x))),
        y: Math.round(Math.max(pad, Math.min(state.height - label.height - pad, candidate.y))),
        width: label.width,
        height: label.height,
      };
    }
    placed.push(chosen);

    if (label.highlighted) {
      const anchor = {
        x: chosen.x > nodeScreen.x ? chosen.x : chosen.x + chosen.width,
        y: chosen.y + chosen.height / 2,
      };
      ctx.save();
      ctx.strokeStyle = rgba(label.accent, 0.22);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(
        nodeScreen.x + (chosen.x > nodeScreen.x ? 8 : -8),
        nodeScreen.y,
      );
      ctx.lineTo(anchor.x, anchor.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = label.highlighted ? 1 : 0.88 + nodeDepth(label.node) * 0.12;
    roundedRect(ctx, chosen.x, chosen.y, chosen.width, chosen.height, 5.5);
    ctx.fillStyle = label.highlighted ? 'rgba(36, 48, 65, 0.98)' : label.node.kind === 'topic' ? 'rgba(26, 35, 50, 0.97)' : 'rgba(13, 20, 32, 0.88)';
    ctx.fill();
    ctx.strokeStyle = label.highlighted
      ? rgba(label.accent, 0.55)
      : label.node.kind === 'topic'
        ? rgba(label.accent, 0.18)
        : 'rgba(226, 246, 239, 0)';
    ctx.lineWidth = label.highlighted ? 0.9 : 0.65;
    ctx.stroke();

    const markerX = chosen.x + 10;
    const markerY = chosen.y + (label.meta ? 16 : chosen.height / 2);
    if (label.node.kind === 'document') {
      ctx.save();
      ctx.translate(markerX, markerY);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = rgba(label.accent, 0.82);
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-2, -2, 4, 4);
      ctx.restore();
    } else if (label.node.kind === 'fragment') {
      ctx.fillStyle = label.accent;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(markerX, markerY, 1.6, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = label.accent;
      ctx.beginPath();
      ctx.arc(markerX, markerY, 2.1, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = label.accent;
      ctx.beginPath();
      ctx.arc(markerX, markerY, 4.1, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.font = label.font;
    ctx.fillStyle = label.node.id === state.selectedId ? '#F0FFF9' : '#E9F1FA';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.title, chosen.x + 22, chosen.y + (label.meta ? 16 : chosen.height / 2));
    if (label.meta) {
      ctx.font = `400 12px ${FONT_UI}`;
      ctx.fillStyle = '#B6C9D9';
      ctx.fillText(label.meta, chosen.x + 12, chosen.y + 36);
    }
    ctx.restore();
  }

  drawRankBadges(ctx, state, scene);
  drawTopicToggles(ctx, state, scene);
}

function drawRankBadges(ctx: CanvasRenderingContext2D, state: SceneState, scene: SceneContext): void {
  for (const [nodeId, rank] of scene.evidenceRanks) {
    const node = scene.visibleMap.get(nodeId);
    if (!node) continue;
    const screen = nodeScreenPosition(node, state.camera);
    if (!pointInViewport(screen, state.width, state.height, 30)) continue;
    const radius = nodeScreenRadius(node, state.camera.state.zoom);
    const badgeX = screen.x - radius - 7.5;
    const badgeY = screen.y - radius - 7.5;
    const current = scene.currentEvidenceId === nodeId;
    const visited = scene.visitedEvidence.has(nodeId);
    ctx.save();
    ctx.fillStyle = current ? 'rgba(242, 210, 149, 0.96)' : 'rgba(9, 15, 18, 0.94)';
    ctx.strokeStyle = current ? 'rgba(255, 242, 206, 0.95)' : rgba(GOLD, visited ? 0.34 : 0.72);
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, 9.5, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = current ? '#1A1710' : rgba(GOLD, visited ? 0.5 : 0.9);
    ctx.font = `500 11px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(rank).padStart(2, '0'), badgeX, badgeY + 0.5);
    ctx.restore();
  }
}

function drawTopicToggles(ctx: CanvasRenderingContext2D, state: SceneState, scene: SceneContext): void {
  for (const node of scene.visibleNodes) {
    if (node.kind !== 'topic') continue;
    const button = topicTogglePosition(node, state.camera);
    if (!pointInViewport(button, state.width, state.height, 20)) continue;
    const collapsed = state.collapsedTopics.has(node.id);
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(6, 12, 15, 0.9)';
    ctx.strokeStyle = rgba(node.color, collapsed ? 0.6 : 0.36);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(button.x, button.y, 7.2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = rgba(node.color, 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(button.x - 3, button.y);
    ctx.lineTo(button.x + 3, button.y);
    if (collapsed) {
      ctx.moveTo(button.x, button.y - 3);
      ctx.lineTo(button.x, button.y + 3);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export function renderScene(ctx: CanvasRenderingContext2D, state: SceneState): void {
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.save();
  const scene = prepareScene(state);
  drawGlobeBack(ctx, state.camera, state.sphereAxes);
  drawDemoRoute(ctx, state, scene);
  drawSphereEdges(ctx, state.graph, state.camera, scene.visibleMap, scene.focusId, false);
  drawNodes(ctx, state, scene, false);
  drawGlobeFront(ctx, state.camera, state.sphereAxes);
  drawSphereEdges(ctx, state.graph, state.camera, scene.visibleMap, scene.focusId, true);
  drawNodes(ctx, state, scene, true);
  drawNodeStates(ctx, state, scene);
  drawContacts(ctx, state, scene);
  drawSpider(ctx, state);
  drawLabels(ctx, state, scene);
  ctx.restore();
}

export function isNodeHidden(node: GraphNode, collapsed: Set<string>): boolean {
  return node.kind !== 'topic' && collapsed.has(node.topicId);
}
