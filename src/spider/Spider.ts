import type { GraphNode } from '../types';
import type { Point } from '../graph/layout';

export type LegId = 'L1' | 'L2' | 'L3' | 'L4' | 'R1' | 'R2' | 'R3' | 'R4';
export type LegSide = -1 | 1;
export type SpiderMode = 'idle' | 'traveling' | 'settling' | 'perched' | 'stopping' | 'dragging';

export interface LegSpec {
  id: LegId;
  side: LegSide;
  naturalAngle: number;
  rootForward: number;
  rootLateral: number;
}

export interface SwingState {
  startedAt: number;
  duration: number;
  from: Point;
  toNodeId: string | null;
  liftScreen: number;
  releasedAnchor: string | null;
}

export interface LegState {
  spec: LegSpec;
  anchorId: string | null;
  swing: SwingState | null;
  lastStepAt: number;
  extension: number;
  contactAt: number;
  contactNodeId: string | null;
}

export type SpiderEvent =
  | { type: 'arrived'; nodeId: string }
  | { type: 'stopped'; reason: string }
  | { type: 'blocked'; nodeId: string | null; reason: string }
  | { type: 'contact'; nodeId: string; legId: LegId };

export interface PerchPlan {
  body: Point;
  heading: number;
  readingLegId: LegId;
  supports: Map<LegId, string>;
  coverage: number;
}

const LEG_SPECS: LegSpec[] = [
  { id: 'L1', side: -1, naturalAngle: -0.7, rootForward: 4.3, rootLateral: 4.2 },
  { id: 'L2', side: -1, naturalAngle: -1.25, rootForward: 0.6, rootLateral: 5.4 },
  { id: 'L3', side: -1, naturalAngle: -1.9, rootForward: -4.4, rootLateral: 5.4 },
  { id: 'L4', side: -1, naturalAngle: -2.38, rootForward: -9.3, rootLateral: 4 },
  { id: 'R1', side: 1, naturalAngle: 0.7, rootForward: 4.3, rootLateral: 4.2 },
  { id: 'R2', side: 1, naturalAngle: 1.25, rootForward: 0.6, rootLateral: 5.4 },
  { id: 'R3', side: 1, naturalAngle: 1.9, rootForward: -4.4, rootLateral: 5.4 },
  { id: 'R4', side: 1, naturalAngle: 2.38, rootForward: -9.3, rootLateral: 4 },
];

const BODY_LENGTH_WORLD = 19;
const SUPPORT_STRETCH = 1.28;
const LANDING_STRETCH = 1.42;
const RELEASE_STRETCH = 1.52;
const TAU = Math.PI * 2;

function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= TAU;
  while (value < -Math.PI) value += TAU;
  return value;
}

function angleDistance(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

function rotateTowards(current: number, target: number, maxDelta: number): number {
  const diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxDelta) return target;
  return normalizeAngle(current + Math.sign(diff) * maxDelta);
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class Spider {
  body: Point = { x: 0, y: 0 };

  velocity: Point = { x: 0, y: 0 };

  heading = -Math.PI / 2;

  legs: LegState[] = LEG_SPECS.map((spec) => ({
    spec,
    anchorId: null,
    swing: null,
    lastStepAt: -10,
    extension: 0.5,
    contactAt: -10,
    contactNodeId: null,
  }));

  reach: number;

  mode: SpiderMode = 'idle';

  targetNodeId: string | null = null;

  destination: Point = { x: 0, y: 0 };

  readingLegId: LegId = 'L1';

  readActive = false;

  readStartedAt = 0;

  readDuration = 1.35;

  simTime = 0;

  private nodes: GraphNode[] = [];

  private nodeMap = new Map<string, GraphNode>();

  private events: SpiderEvent[] = [];

  private finalSupports = new Map<LegId, string>();

  private settleStartedAt = 0;

  private nextGaitAt = 0;

  private gaitFlip = false;

  private arrivalFired = false;

  private pendingBlockReason: string | null = null;

  private stopReason = '';

  constructor(reach = 150) {
    this.reach = reach;
  }

  get bodyNodes(): GraphNode[] {
    return this.nodes;
  }

  get currentSupports(): Set<string> {
    return new Set(
      this.legs
        .filter((leg) => leg.anchorId)
        .map((leg) => leg.anchorId as string),
    );
  }

  setReach(reach: number): void {
    this.reach = clamp(reach, 70, 220);
  }

  setNodes(nodes: GraphNode[]): void {
    this.nodes = nodes;
    this.nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const missing = this.legs.filter((leg) => leg.anchorId && !this.nodeMap.has(leg.anchorId));
    for (const leg of missing) {
      leg.anchorId = null;
      if (!leg.swing) {
        this.beginSwing(leg, null, 0.3);
      }
    }
  }

  hasNode(nodeId: string): boolean {
    return this.nodeMap.has(nodeId);
  }

  getNode(nodeId: string): GraphNode | undefined {
    return this.nodeMap.get(nodeId);
  }

  consumeEvents(): SpiderEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  addEvent(event: SpiderEvent): void {
    this.events.push(event);
  }

  rootWorld(leg: LegState): Point {
    const forward = { x: Math.cos(this.heading), y: Math.sin(this.heading) };
    const right = { x: -forward.y, y: forward.x };
    return {
      x: this.body.x + forward.x * leg.spec.rootForward + right.x * leg.spec.side * leg.spec.rootLateral,
      y: this.body.y + forward.y * leg.spec.rootForward + right.y * leg.spec.side * leg.spec.rootLateral,
    };
  }

  tuckPoint(leg: LegState): Point {
    const angle = this.heading + leg.spec.naturalAngle * 0.82;
    const length = this.reach * 0.46;
    return {
      x: this.rootWorld(leg).x + Math.cos(angle) * length,
      y: this.rootWorld(leg).y + Math.sin(angle) * length,
    };
  }

  getFootWorld(leg: LegState): Point {
    if (leg.swing) {
      const to = this.swingTarget(leg);
      const t = this.swingProgress(leg);
      const eased = easeInOutSine(t);
      const from = leg.swing.from;
      const point = lerpPoint(from, to, eased);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      const curl = Math.sin(Math.PI * t) * Math.min(26, distance * 0.16) * leg.spec.side;
      return { x: point.x - (dy / distance) * curl, y: point.y + (dx / distance) * curl };
    }
    if (leg.anchorId) {
      const node = this.nodeMap.get(leg.anchorId);
      if (node) return { x: node.x, y: node.y };
    }
    return this.tuckPoint(leg);
  }

  getSwingLift(leg: LegState): number {
    if (!leg.swing) return 0;
    return Math.sin(Math.PI * this.swingProgress(leg)) * leg.swing.liftScreen;
  }

  getSwingProgress(leg: LegState): number {
    return this.swingProgress(leg);
  }

  getReadingProgress(): number {
    if (!this.readActive) return 0;
    return clamp((this.simTime - this.readStartedAt) / this.readDuration, 0, 1);
  }

  getBodyPoints(): Point[] {
    const forward = { x: Math.cos(this.heading), y: Math.sin(this.heading) };
    return [
      { x: this.body.x - forward.x * BODY_LENGTH_WORLD * 0.48, y: this.body.y - forward.y * BODY_LENGTH_WORLD * 0.48 },
      { x: this.body.x - forward.x * 2, y: this.body.y - forward.y * 2 },
      { x: this.body.x + forward.x * 6.8, y: this.body.y + forward.y * 6.8 },
      { x: this.body.x + forward.x * 10.5, y: this.body.y + forward.y * 10.5 },
    ];
  }

  initialize(nodes: GraphNode[], focus: Point): void {
    this.setNodes(nodes);
    const fragments = nodes.filter((node) => node.kind === 'fragment');
    const candidates = fragments.length ? fragments : nodes;
    if (!candidates.length) return;

    let bestNode = candidates[0];
    let bestScore = -Infinity;
    for (const node of candidates) {
      const localCount = nodes.filter(
        (other) => Math.hypot(other.x - node.x, other.y - node.y) < this.reach * 0.9,
      ).length;
      const distanceToFocus = Math.hypot(node.x - focus.x, node.y - focus.y);
      const score = localCount * 8 - distanceToFocus * 0.6;
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    const plan = this.planPerch(bestNode, this.body);
    this.body = { ...plan.body };
    this.destination = { ...plan.body };
    this.heading = plan.heading;
    this.velocity = { x: 0, y: 0 };
    this.mode = 'idle';
    this.targetNodeId = null;
    this.readActive = false;
    this.legs.forEach((leg) => {
      const support = plan.supports.get(leg.spec.id);
      leg.anchorId = support ?? null;
      leg.swing = null;
      leg.contactAt = -10;
      leg.contactNodeId = null;
      const foot = this.getFootWorld(leg);
      const root = this.rootWorld(leg);
      leg.extension = Math.hypot(foot.x - root.x, foot.y - root.y) / this.reach;
    });
    this.ensureDistinctAnchors(this.readingLegId, null);
  }

  moveToNode(nodeId: string): { ok: boolean; reason?: string } {
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      this.events.push({ type: 'blocked', nodeId, reason: '目标节点不存在或已被隐藏' });
      return { ok: false, reason: '目标节点不存在或已被隐藏' };
    }
    const plan = this.planPerch(node, this.body);
    this.targetNodeId = node.id;
    this.destination = { ...plan.body };
    this.readingLegId = plan.readingLegId;
    this.finalSupports = plan.supports;
    this.readActive = false;
    this.arrivalFired = false;
    this.pendingBlockReason = null;
    this.mode = 'traveling';
    const distance = Math.hypot(this.destination.x - this.body.x, this.destination.y - this.body.y);
    if (distance < 2.3) {
      this.beginSettling();
    }
    return { ok: true };
  }

  retargetAfterLayout(nodeId: string): { ok: boolean; reason?: string } {
    if (!this.hasNode(nodeId)) {
      this.cancelTarget('目标已从知识网络中移除');
      return { ok: false, reason: '目标已从知识网络中移除' };
    }
    return this.moveToNode(nodeId);
  }

  cancelTarget(reason: string): void {
    this.pendingBlockReason = reason;
    this.targetNodeId = null;
    this.finalSupports.clear();
    this.readActive = false;
    this.mode = 'stopping';
    this.stopReason = reason;
  }

  stopMovement(reason = '移动已停止'): void {
    this.targetNodeId = null;
    this.finalSupports.clear();
    this.readActive = false;
    this.mode = 'stopping';
    this.stopReason = reason;
    this.pendingBlockReason = null;
  }

  beginBodyDrag(): void {
    this.velocity = { x: 0, y: 0 };
    this.mode = 'dragging';
    this.readActive = false;
  }

  dragBodyTo(point: Point): void {
    this.body = { ...point };
    this.velocity = { x: 0, y: 0 };
    this.mode = 'dragging';
    this.detachOverstretched();
  }

  endBodyDrag(): void {
    this.mode = 'idle';
    this.settleLocally();
  }

  handleLayoutChange(): void {
    this.detachOverstretched();
    if (this.targetNodeId) {
      const node = this.nodeMap.get(this.targetNodeId);
      if (!node) {
        this.cancelTarget('目标已从知识网络中移除');
      }
    }
  }

  tick(dt: number): void {
    if (dt <= 0) return;
    this.simTime += dt;
    this.advanceSwings();
    this.detachOverstretched();

    if (this.mode === 'traveling') {
      this.updateTravel(dt);
    } else if (this.mode === 'stopping') {
      this.updateStopping(dt);
    } else if (this.mode === 'settling') {
      this.updateSettling(dt);
    } else if (this.mode === 'perched' || this.mode === 'idle' || this.mode === 'dragging') {
      this.velocity = { x: 0, y: 0 };
      this.rotateIdle(dt);
    }

    if (this.readActive && this.simTime - this.readStartedAt > this.readDuration + 0.25) {
      this.readActive = false;
    }
    for (const leg of this.legs) {
      const foot = this.getFootWorld(leg);
      const root = this.rootWorld(leg);
      const stretch = clamp(Math.hypot(foot.x - root.x, foot.y - root.y) / this.reach, 0.25, RELEASE_STRETCH);
      leg.extension += (stretch - leg.extension) * (1 - Math.exp(-12 * dt));
    }
  }

  private swingProgress(leg: LegState): number {
    if (!leg.swing) return 1;
    return clamp((this.simTime - leg.swing.startedAt) / leg.swing.duration, 0, 1);
  }

  private swingTarget(leg: LegState): Point {
    if (!leg.swing) return this.tuckPoint(leg);
    if (leg.swing.toNodeId) {
      const node = this.nodeMap.get(leg.swing.toNodeId);
      if (node) return { x: node.x, y: node.y };
      return this.tuckPoint(leg);
    }
    return this.tuckPoint(leg);
  }

  private advanceSwings(): void {
    for (const leg of this.legs) {
      if (!leg.swing) continue;
      const progress = this.swingProgress(leg);
      if (progress >= 1) {
        const swing = leg.swing;
        leg.swing = null;
        if (swing.toNodeId && this.nodeMap.has(swing.toNodeId)) {
          const root = this.rootWorld(leg);
          const node = this.nodeMap.get(swing.toNodeId);
          if (node) {
            const distance = Math.hypot(node.x - root.x, node.y - root.y);
            if (distance <= this.reach * LANDING_STRETCH) {
              leg.anchorId = swing.toNodeId;
              leg.contactAt = this.simTime;
              leg.contactNodeId = swing.toNodeId;
              this.events.push({ type: 'contact', nodeId: swing.toNodeId, legId: leg.spec.id });
            } else {
              leg.anchorId = null;
            }
          }
        } else {
          leg.anchorId = null;
        }
      }
    }
  }

  private detachOverstretched(): void {
    for (const leg of this.legs) {
      if (!leg.anchorId || leg.swing) continue;
      const node = this.nodeMap.get(leg.anchorId);
      if (!node) {
        leg.anchorId = null;
        continue;
      }
      const root = this.rootWorld(leg);
      if (Math.hypot(node.x - root.x, node.y - root.y) > this.reach * RELEASE_STRETCH) {
        leg.anchorId = null;
        this.beginSwing(leg, null, 0.28);
      }
    }
  }

  private anchoredCount(): number {
    return this.legs.filter((leg) => leg.anchorId && !leg.swing).length;
  }

  private swingingCount(): number {
    return this.legs.filter((leg) => leg.swing).length;
  }

  private maxStretch(): number {
    let max = 0;
    for (const leg of this.legs) {
      if (!leg.anchorId || leg.swing) continue;
      const node = this.nodeMap.get(leg.anchorId);
      if (!node) continue;
      const root = this.rootWorld(leg);
      max = Math.max(max, Math.hypot(node.x - root.x, node.y - root.y) / this.reach);
    }
    return max;
  }

  private updateTravel(dt: number): void {
    const dx = this.destination.x - this.body.x;
    const dy = this.destination.y - this.body.y;
    const distance = Math.hypot(dx, dy);
    const targetNode = this.targetNodeId ? this.nodeMap.get(this.targetNodeId) : null;
    if (this.targetNodeId && !targetNode) {
      this.cancelTarget('目标已从知识网络中移除');
      return;
    }

    const speedNow = Math.hypot(this.velocity.x, this.velocity.y);
    const anchors = this.anchoredCount();
    const supportFactor = clamp(0.7 + anchors * 0.045, 0.72, 1);
    const swingFactor = this.swingingCount() > 0 ? 0.92 : 1;
    const maxStretch = this.maxStretch();
    const stretchFactor = maxStretch > 1.4 ? 0.38 : maxStretch > 1.14 ? 0.78 : 1;
    const gapCare = anchors < 2 ? 0.32 : 1;
    const maxSpeed = 320 * supportFactor * swingFactor * stretchFactor * gapCare;
    const desiredSpeed = Math.min(maxSpeed, distance * 2.15);
    const dirX = distance > 0.001 ? dx / distance : 0;
    const dirY = distance > 0.001 ? dy / distance : 0;
    const response = 1 - Math.exp(-3.8 * dt);
    this.velocity.x += (dirX * desiredSpeed - this.velocity.x) * response;
    this.velocity.y += (dirY * desiredSpeed - this.velocity.y) * response;
    this.body.x += this.velocity.x * dt;
    this.body.y += this.velocity.y * dt;

    if (distance > 0.1) {
      const desiredHeading = Math.atan2(dy, dx);
      const speed = Math.hypot(this.velocity.x, this.velocity.y);
      if (speed > 8) {
        this.heading = rotateTowards(this.heading, desiredHeading, 2.6 * dt);
      }
    }

    if (this.simTime >= this.nextGaitAt && this.swingingCount() < 2) {
      this.scheduleTravelSteps();
      this.nextGaitAt = this.simTime + clamp(0.26 - this.anchoredCount() * 0.005, 0.17, 0.28);
    }

    const remaining = Math.hypot(this.destination.x - this.body.x, this.destination.y - this.body.y);
    if (remaining < 2.4 && speedNow < 16) {
      this.velocity = { x: 0, y: 0 };
      this.beginSettling();
    }
  }

  private scheduleTravelSteps(): void {
    const now = this.simTime;
    const anchors = this.anchoredCount();
    const slots = Math.max(0, 2 - this.swingingCount());
    if (slots <= 0) return;

    this.gaitFlip = !this.gaitFlip;
    const primarySide = this.gaitFlip ? 1 : -1;
    const anchored = this.legs
      .filter((leg) => leg.anchorId && !leg.swing && now - leg.lastStepAt > 0.16)
      .map((leg) => ({ leg, stretch: this.stretchOf(leg) }))
      .sort((a, b) => b.stretch - a.stretch);
    const free = this.legs.filter(
      (leg) => !leg.anchorId && !leg.swing && now - leg.lastStepAt > 0.16,
    );
    const tryOrder = [
      ...anchored.filter((entry) => entry.stretch > 0.72),
      ...free.map((leg) => ({ leg, stretch: 0.4 })),
      ...anchored.filter((entry) => entry.stretch <= 0.72),
    ];
    const sidePreference = (leg: LegState) => (leg.spec.side === primarySide ? 0 : 1);
    tryOrder.sort((a, b) => {
      const sideDelta = sidePreference(a.leg) - sidePreference(b.leg);
      if (sideDelta !== 0) return sideDelta;
      return b.stretch - a.stretch;
    });

    const chosen: LegState[] = [];
    let anchorsLeft = anchors;
    for (const entry of tryOrder) {
      if (chosen.length >= slots) break;
      const leg = entry.leg;
      if (chosen.includes(leg)) continue;
      if (leg.anchorId) {
        if (anchorsLeft <= 1) continue;
        const support = this.findDynamicSupport(leg);
        if (!support) continue;
        const currentFoot = this.nodeMap.get(leg.anchorId);
        if (currentFoot) {
          const root = this.rootWorld(leg);
          const currentDistance = Math.hypot(currentFoot.x - root.x, currentFoot.y - root.y);
          const candidateDistance = Math.hypot(support.x - root.x, support.y - root.y);
          if (candidateDistance > currentDistance - 3) continue;
        }
        leg.lastStepAt = now;
        anchorsLeft -= 1;
        const jitter = (hashString(`${leg.spec.id}-${Math.floor(now * 1000)}`) % 45) / 1000;
        this.beginSwing(leg, support.id, 0.27 + jitter);
        chosen.push(leg);
      } else {
        const support = this.findDynamicSupport(leg);
        if (!support) continue;
        leg.lastStepAt = now;
        const jitter = (hashString(`${leg.spec.id}-${Math.floor(now * 1000)}`) % 45) / 1000;
        this.beginSwing(leg, support.id, 0.25 + jitter);
        chosen.push(leg);
      }
    }
  }

  private stretchOf(leg: LegState): number {
    if (!leg.anchorId) return 0;
    const node = this.nodeMap.get(leg.anchorId);
    if (!node) return 1;
    const root = this.rootWorld(leg);
    return Math.hypot(node.x - root.x, node.y - root.y) / this.reach;
  }

  private findDynamicSupport(leg: LegState): GraphNode | null {
    const root = this.rootWorld(leg);
    const used = new Set<string>();
    for (const other of this.legs) {
      if (other === leg) continue;
      if (other.anchorId) used.add(other.anchorId);
      if (other.swing?.toNodeId) used.add(other.swing.toNodeId);
    }
    let best: GraphNode | null = null;
    let bestScore = Infinity;
    for (const node of this.nodes) {
      if (used.has(node.id)) continue;
      if (node.id === this.targetNodeId && this.mode === 'traveling' && this.targetNodeId) {
        // The reading contact is reserved for the final perch.
        if (this.legs.some((entry) => entry.anchorId === node.id)) continue;
      }
      const distance = Math.hypot(node.x - root.x, node.y - root.y);
      if (distance < this.reach * 0.18 || distance > this.reach * SUPPORT_STRETCH) continue;
      const rel = normalizeAngle(Math.atan2(node.y - root.y, node.x - root.x) - this.heading);
      if (Math.abs(rel) > 2.32) continue;
      if (leg.spec.side < 0 && rel > 0.16) continue;
      if (leg.spec.side > 0 && rel < -0.16) continue;
      const angular = angleDistance(rel, leg.spec.naturalAngle);
      if (angular > 1.38) continue;
      const bodyDistance = Math.hypot(node.x - this.body.x, node.y - this.body.y);
      if (bodyDistance < Math.min(24, this.reach * 0.14)) continue;
      const score = angular + (distance / this.reach) * 0.38 + node.order * 0.00003;
      if (score < bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  private beginSwing(leg: LegState, toNodeId: string | null, duration: number): void {
    const from = this.getFootWorld(leg);
    const releasedAnchor = leg.anchorId;
    const toNode = toNodeId ? this.nodeMap.get(toNodeId) : null;
    const distance = toNode
      ? Math.hypot(toNode.x - from.x, toNode.y - from.y)
      : Math.hypot(this.tuckPoint(leg).x - from.x, this.tuckPoint(leg).y - from.y);
    leg.anchorId = null;
    leg.swing = {
      startedAt: this.simTime,
      duration: clamp(duration + distance / 1300, 0.3, 0.64),
      from,
      toNodeId,
      liftScreen: 14 + Math.min(19, distance * 0.035),
      releasedAnchor,
    };
  }

  private updateStopping(dt: number): void {
    const damping = Math.exp(-4.8 * dt);
    this.velocity.x *= damping;
    this.velocity.y *= damping;
    this.body.x += this.velocity.x * dt;
    this.body.y += this.velocity.y * dt;
    if (Math.hypot(this.velocity.x, this.velocity.y) < 11) {
      this.velocity = { x: 0, y: 0 };
      this.mode = 'idle';
      this.readActive = false;
      this.settleLocally();
      this.events.push({ type: 'stopped', reason: this.stopReason });
    }
  }

  private settleLocally(): void {
    const target = this.targetNodeId ? this.nodeMap.get(this.targetNodeId) : null;
    const readingSide = this.readingLegId === 'L1' || this.readingLegId === 'L2' || this.readingLegId === 'L3' || this.readingLegId === 'L4' ? -1 : 1;
    const heading = target
      ? Math.atan2(target.y - this.body.y, target.x - this.body.x) - readingSide * 0.16
      : this.heading;
    this.finalSupports = target
      ? this.assignSettleSupports(this.body, target, heading, this.readingLegId)
      : this.assignLocalSupports(this.body, heading);
    this.mode = 'settling';
    this.settleStartedAt = this.simTime;
    this.arrivalFired = false;
  }

  private beginSettling(): void {
    if (!this.targetNodeId) {
      this.mode = 'idle';
      this.settleLocally();
      return;
    }
    const target = this.nodeMap.get(this.targetNodeId);
    if (!target) {
      this.cancelTarget('目标已从知识网络中移除');
      return;
    }
    const readingSide = this.sideOfLeg(this.readingLegId);
    const heading = Math.atan2(target.y - this.body.y, target.x - this.body.x) - readingSide * 0.16;
    this.finalSupports = this.assignSettleSupports(this.body, target, heading, this.readingLegId);
    this.mode = 'settling';
    this.settleStartedAt = this.simTime;
    this.arrivalFired = false;
    this.readActive = false;
  }

  private assignSettleSupports(
    body: Point,
    target: GraphNode,
    heading: number,
    readingLegId: LegId,
  ): Map<LegId, string> {
    const supports = new Map<LegId, string>();
    supports.set(readingLegId, target.id);
    const used = new Set<string>([target.id]);

    // Reuse anchored feet first. This is what keeps arrival from turning into a
    // second full re-layout of the eight legs.
    for (const leg of this.legs) {
      if (leg.spec.id === readingLegId) continue;
      if (!leg.anchorId || leg.swing) continue;
      if (leg.anchorId === target.id || used.has(leg.anchorId)) continue;
      const node = this.nodeMap.get(leg.anchorId);
      if (!node) continue;
      const root = this.rootAt(body, heading, leg);
      const distance = Math.hypot(node.x - root.x, node.y - root.y);
      if (distance > this.reach * SUPPORT_STRETCH) continue;
      supports.set(leg.spec.id, leg.anchorId);
      used.add(leg.anchorId);
    }

    const remaining = this.legs
      .filter((leg) => leg.spec.id !== readingLegId && !supports.has(leg.spec.id))
      .sort((a, b) => a.spec.side - b.spec.side);
    for (const leg of remaining) {
      const root = this.rootAt(body, heading, leg);
      let best: { node: GraphNode; score: number } | null = null;
      for (const node of this.nodes) {
        if (used.has(node.id)) continue;
        if (node.id === target.id) continue;
        const distance = Math.hypot(node.x - root.x, node.y - root.y);
        if (distance < this.reach * 0.16 || distance > this.reach * SUPPORT_STRETCH) continue;
        const bodyDistance = Math.hypot(node.x - body.x, node.y - body.y);
        if (bodyDistance < Math.min(30, this.reach * 0.18)) continue;
        const rel = normalizeAngle(Math.atan2(node.y - root.y, node.x - root.x) - heading);
        if (leg.spec.side < 0 && rel > 0.2) continue;
        if (leg.spec.side > 0 && rel < -0.2) continue;
        const angular = angleDistance(rel, leg.spec.naturalAngle);
        if (angular > 1.55) continue;
        const score = angular * 1.15 + (distance / this.reach) * 0.55 + node.order * 0.0001;
        if (!best || score < best.score) best = { node, score };
      }
      if (best) {
        supports.set(leg.spec.id, best.node.id);
        used.add(best.node.id);
      }
    }
    return supports;
  }

  private updateSettling(dt: number): void {
    this.velocity = { x: 0, y: 0 };
    const target = this.targetNodeId ? this.nodeMap.get(this.targetNodeId) : null;
    if (target) {
      const readingSide = this.sideOfLeg(this.readingLegId);
      const desiredHeading = Math.atan2(target.y - this.body.y, target.x - this.body.x) - readingSide * 0.16;
      this.heading = rotateTowards(this.heading, desiredHeading, 2.2 * dt);
    }
    this.scheduleSettleSteps();
    const elapsed = this.simTime - this.settleStartedAt;
    const requiredSupports = [...this.finalSupports.entries()];
    const targetLeg = this.legs.find((leg) => leg.spec.id === this.readingLegId);
    const targetContact = Boolean(
      target && targetLeg && targetLeg.anchorId === target.id && !targetLeg.swing,
    );
    const allSupportedReady = requiredSupports.every(([legId, nodeId]) => {
      const leg = this.legs.find((entry) => entry.spec.id === legId);
      return leg && leg.anchorId === nodeId && !leg.swing;
    });
    if (targetContact && allSupportedReady) {
      this.finishArrival(target ?? null);
    } else if (elapsed > 2.1) {
      if (targetContact) {
        this.finishArrival(target ?? null);
      } else if (this.pendingBlockReason) {
        this.mode = 'idle';
        this.events.push({
          type: 'blocked',
          nodeId: this.targetNodeId,
          reason: this.pendingBlockReason,
        });
        this.pendingBlockReason = null;
      }
    }
  }

  private finishArrival(target: GraphNode | null): void {
    if (this.arrivalFired) return;
    this.arrivalFired = true;
    this.mode = 'perched';
    this.velocity = { x: 0, y: 0 };
    const readingLeg = this.legs.find((leg) => leg.spec.id === this.readingLegId);
    if (target && readingLeg?.anchorId === target.id) {
      this.readActive = true;
      this.readStartedAt = this.simTime;
      this.events.push({ type: 'arrived', nodeId: target.id });
      if (this.pendingBlockReason) {
        this.events.push({ type: 'blocked', nodeId: target.id, reason: this.pendingBlockReason });
        this.pendingBlockReason = null;
      }
    } else if (target) {
      this.events.push({ type: 'blocked', nodeId: target.id, reason: '目标附近没有可稳定接触的支撑位置' });
    }
  }

  private scheduleSettleSteps(): void {
    if (this.swingingCount() >= 2) return;
    const target = this.targetNodeId ? this.nodeMap.get(this.targetNodeId) : null;
    if (!target) return;
    const readingLeg = this.legs.find((leg) => leg.spec.id === this.readingLegId);
    if (!readingLeg) return;

    const work: Array<{ leg: LegState; nodeId: string | null; priority: number }> = [];
    for (const leg of this.legs) {
      if (leg.swing) continue;
      const desired = this.finalSupports.get(leg.spec.id) ?? null;
      if (desired) {
        if (leg.anchorId !== desired) {
          work.push({
            leg,
            nodeId: desired,
            priority: leg.spec.id === this.readingLegId ? 0 : 1,
          });
        }
      } else if (leg.anchorId) {
        const uniqueKeep =
          leg.anchorId !== target.id &&
          !this.legs.some(
            (other) =>
              other !== leg &&
              (other.anchorId === leg.anchorId || other.swing?.toNodeId === leg.anchorId),
          );
        if (!uniqueKeep) {
          work.push({ leg, nodeId: null, priority: 3 });
        }
      } else {
        const tuckDistance = Math.hypot(
          this.tuckPoint(leg).x - this.getFootWorld(leg).x,
          this.tuckPoint(leg).y - this.getFootWorld(leg).y,
        );
        if (tuckDistance > this.reach * 0.15) {
          work.push({ leg, nodeId: null, priority: 4 });
        }
      }
    }
    if (!work.length) return;

    work.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const sideOrder = (leg: LegState) => (leg.spec.side === 1 ? 0 : 1);
      return sideOrder(a.leg) - sideOrder(b.leg);
    });

    const slots = 2 - this.swingingCount();
    const readingWork = work.find((entry) => entry.leg.spec.id === this.readingLegId);
    const chosen: typeof work = [];
    if (readingWork) chosen.push(readingWork);
    for (const entry of work) {
      if (chosen.length >= slots) break;
      if (entry === readingWork) continue;
      const oppositeSideAlready = chosen.some(
        (chosenEntry) => chosenEntry.leg.spec.side !== entry.leg.spec.side,
      );
      if (chosen.length === 0 || oppositeSideAlready) chosen.push(entry);
    }
    for (const entry of work) {
      if (chosen.length >= slots) break;
      if (!chosen.includes(entry)) chosen.push(entry);
    }

    for (const entry of chosen) {
      if (entry.nodeId) {
        this.beginSwing(entry.leg, entry.nodeId, 0.3);
      } else {
        this.beginSwing(entry.leg, null, 0.26);
      }
    }

    const targetLeg = this.legs.find((leg) => leg.spec.id === this.readingLegId);
    if (targetLeg && targetLeg.anchorId === target.id && !targetLeg.swing) {
      this.readStartedAt = this.simTime;
    }
  }

  private rotateIdle(dt: number): void {
    if (!this.targetNodeId) return;
    const node = this.nodeMap.get(this.targetNodeId);
    if (!node) return;
    const readingSide = this.sideOfLeg(this.readingLegId);
    const desired = Math.atan2(node.y - this.body.y, node.x - this.body.x) - readingSide * 0.16;
    this.heading = rotateTowards(this.heading, desired, 1.8 * dt);
  }

  private sideOfLeg(id: LegId): -1 | 1 {
    return id.startsWith('L') ? -1 : 1;
  }

  private planPerch(target: GraphNode, currentBody: Point): PerchPlan {
    const readingSide = hashString(target.id) % 2 === 0 ? -1 : 1;
    const readingLegId: LegId = readingSide === -1 ? 'L1' : 'R1';
    let bestPlan: PerchPlan | null = null;
    let bestScore = -Infinity;
    const approachAngle = Math.atan2(currentBody.y - target.y, currentBody.x - target.x);

    for (const distanceFactor of [0.38, 0.46, 0.54]) {
      for (let step = 0; step < 24; step += 1) {
        const offset = (step / 24) * TAU;
        const candidateAngle = approachAngle + Math.PI + offset;
        const radius = this.reach * distanceFactor;
        const body = {
          x: target.x + Math.cos(candidateAngle) * radius,
          y: target.y + Math.sin(candidateAngle) * radius,
        };
        let bodyScore = 0;
        const bodyClearance = Math.min(38, this.reach * 0.19);
        for (const node of this.nodes) {
          const nodeDistance = Math.hypot(node.x - body.x, node.y - body.y);
          if (nodeDistance < bodyClearance) bodyScore -= 240;
        }
        const heading = Math.atan2(target.y - body.y, target.x - body.x) - readingSide * 0.16;
        const supports = this.assignSupports(body, target, heading, readingLegId);
        const coverage = supports.size;
        const distanceFromCurrent = Math.hypot(body.x - currentBody.x, body.y - currentBody.y);
        let quality = 0;
        for (const [legId, nodeId] of supports) {
          const leg = this.legs.find((entry) => entry.spec.id === legId);
          const node = this.nodeMap.get(nodeId);
          if (!leg || !node) continue;
          const root = this.rootAt(body, heading, leg);
          const distance = Math.hypot(node.x - root.x, node.y - root.y);
          quality += 1 - clamp(distance / this.reach, 0, 1);
        }
        const score =
          coverage * 1000 +
          quality * 12 -
          Math.abs(distanceFactor - 0.42) * 80 -
          distanceFromCurrent * 0.018 +
          bodyScore;
        if (score > bestScore) {
          bestScore = score;
          bestPlan = {
            body,
            heading,
            readingLegId,
            supports,
            coverage,
          };
        }
      }
    }

    if (bestPlan) return bestPlan;
    const body = {
      x: target.x + Math.cos(approachAngle) * this.reach * 0.4,
      y: target.y + Math.sin(approachAngle) * this.reach * 0.4,
    };
    return {
      body,
      heading: Math.atan2(target.y - body.y, target.x - body.x),
      readingLegId,
      supports: new Map([[readingLegId, target.id]]),
      coverage: 1,
    };
  }

  private rootAt(body: Point, heading: number, leg: LegState): Point {
    const forward = { x: Math.cos(heading), y: Math.sin(heading) };
    const right = { x: -forward.y, y: forward.x };
    return {
      x: body.x + forward.x * leg.spec.rootForward + right.x * leg.spec.side * leg.spec.rootLateral,
      y: body.y + forward.y * leg.spec.rootForward + right.y * leg.spec.side * leg.spec.rootLateral,
    };
  }

  private assignSupports(
    body: Point,
    target: GraphNode,
    heading: number,
    readingLegId: LegId,
  ): Map<LegId, string> {
    const supports = new Map<LegId, string>();
    supports.set(readingLegId, target.id);
    const used = new Set<string>([target.id]);
    const ordered = this.legs
      .filter((leg) => leg.spec.id !== readingLegId)
      .sort((a, b) => {
        if (a.spec.side !== b.spec.side) return a.spec.side - b.spec.side;
        return Math.abs(Math.abs(a.spec.naturalAngle) - 1.35) - Math.abs(Math.abs(b.spec.naturalAngle) - 1.35);
      });

    for (const leg of ordered) {
      const root = this.rootAt(body, heading, leg);
      let best: { node: GraphNode; score: number } | null = null;
      for (const node of this.nodes) {
        if (used.has(node.id)) continue;
        const distance = Math.hypot(node.x - root.x, node.y - root.y);
        if (distance < this.reach * 0.16 || distance > this.reach * SUPPORT_STRETCH) continue;
        const bodyDistance = Math.hypot(node.x - body.x, node.y - body.y);
        if (bodyDistance < Math.min(30, this.reach * 0.18)) continue;
        const rel = normalizeAngle(Math.atan2(node.y - root.y, node.x - root.x) - heading);
        if (leg.spec.side < 0 && rel > 0.2) continue;
        if (leg.spec.side > 0 && rel < -0.2) continue;
        const angular = angleDistance(rel, leg.spec.naturalAngle);
        if (angular > 1.55) continue;
        const score = angular * 1.15 + (distance / this.reach) * 0.55 + node.order * 0.0001;
        if (!best || score < best.score) best = { node, score };
      }
      if (best) {
        supports.set(leg.spec.id, best.node.id);
        used.add(best.node.id);
      }
    }
    return supports;
  }

  private assignLocalSupports(body: Point, heading: number): Map<LegId, string> {
    const supports = new Map<LegId, string>();
    const used = new Set<string>();
    for (const leg of this.legs) {
      const root = this.rootAt(body, heading, leg);
      let best: { node: GraphNode; score: number } | null = null;
      for (const node of this.nodes) {
        if (used.has(node.id)) continue;
        const distance = Math.hypot(node.x - root.x, node.y - root.y);
        if (distance < this.reach * 0.16 || distance > this.reach * SUPPORT_STRETCH) continue;
        const bodyDistance = Math.hypot(node.x - body.x, node.y - body.y);
        if (bodyDistance < Math.min(30, this.reach * 0.18)) continue;
        const rel = normalizeAngle(Math.atan2(node.y - root.y, node.x - root.x) - heading);
        if (leg.spec.side < 0 && rel > 0.24) continue;
        if (leg.spec.side > 0 && rel < -0.24) continue;
        const angular = angleDistance(rel, leg.spec.naturalAngle);
        if (angular > 1.5) continue;
        const score = angular + (distance / this.reach) * 0.5;
        if (!best || score < best.score) best = { node, score };
      }
      if (best) {
        supports.set(leg.spec.id, best.node.id);
        used.add(best.node.id);
      }
    }
    return supports;
  }

  private ensureDistinctAnchors(readingLegId: LegId, targetId: string | null): void {
    const seen = new Set<string>();
    if (targetId) seen.add(targetId);
    for (const leg of this.legs) {
      if (leg.spec.id === readingLegId && targetId) continue;
      if (!leg.anchorId) continue;
      if (seen.has(leg.anchorId)) {
        leg.anchorId = null;
      } else {
        seen.add(leg.anchorId);
      }
    }
  }
}
