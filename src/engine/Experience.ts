import type {
  DemoUiState,
  EngineNotice,
  EngineUiState,
  GraphModel,
  GraphNode,
  MotionPhase,
  SearchSnapshot,
} from '../types';
import { Camera } from '../graph/camera';
import { graphBounds, layoutGraph, rotateGraph, rotateSpatialPoint, snapshotPositions, syncSpatialPosition, type Point, type SpatialPoint } from '../graph/layout';
import { Spider, type SpiderEvent } from '../spider/Spider';
import { hitNode, hitSpiderBody, hitTopicToggle } from '../render/hit';
import { renderScene, type SceneState } from '../render/scene';

export interface ExperienceCallbacks {
  onState: (state: EngineUiState) => void;
  onUserSelect?: (nodeId: string) => void;
  onBlankClick?: () => void;
}

interface Pointers {
  [id: number]: Point;
}

type Gesture =
  | { mode: 'orbit'; previous: Point }
  | {
      mode: 'pending';
      kind: 'blank' | 'node' | 'toggle' | 'body';
      start: Point;
      current: Point;
      nodeId?: string;
      moved: boolean;
    }
  | {
      mode: 'pan';
      start: Point;
      previous: Point;
      moved: boolean;
    }
  | {
      mode: 'node-drag';
      nodeId: string;
      start: Point;
      startPositions: Map<string, Point>;
    }
  | {
      mode: 'body-drag';
      start: Point;
    }
  | {
      mode: 'pinch';
      pointerIds: number[];
      previousDistance: number;
      previousMid: Point;
    };

const CLICK_THRESHOLD = 6;
const READ_DURATION = 0.92;
const AUTO_BETWEEN_DELAY = 0.2;
const SPEEDS = [0.5, 1, 2];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function worldDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class Experience {
  graph: GraphModel;

  private canvas: HTMLCanvasElement;

  private ctx: CanvasRenderingContext2D;

  private callbacks: ExperienceCallbacks;

  private camera = new Camera();

  private spider: Spider;

  private visibleNodes: GraphNode[] = [];

  private pointerState: Pointers = {};

  private gesture: Gesture | null = null;

  private panelInset = 0;

  private lastFrame = 0;

  private frameHandle = 0;

  private destroyed = false;

  private initialized = false;

  private dpr = 1;

  private width = 1;

  private height = 1;

  private initialZoom = 0.7;

  private cameraTouched = false;

  private followCamera = true;
  private sphereAxes: SpatialPoint[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];

  private reducedMotion = false;

  private paused = false;

  private speed = 1;

  private mode: 'manual' | 'auto' = 'manual';

  private phase: MotionPhase = 'idle';

  private selectedId: string | null = null;

  private selectedOrigin: 'user' | 'auto' | null = null;

  private targetId: string | null = null;

  private activeTargetOrigin: 'manual' | 'auto' | null = null;

  private hoverId: string | null = null;

  private collapsedTopics = new Set<string>();

  private manualVisited = new Set<string>();

  private snapshot: SearchSnapshot | null = null;

  private demoStatus: 'idle' | 'running' | 'paused' | 'complete' = 'idle';

  private demoVisited: string[] = [];

  private demoOrder: string[] = [];

  private demoCurrentId: string | null = null;

  private stepOnce = false;

  private interactionDragging = false;

  private autoWaiting = false;

  private autoWaitElapsed = 0;

  private readingElapsed = 0;

  private readingSource: 'auto' | 'manual' | null = null;

  private currentEvidenceId: string | null = null;

  private notice: EngineNotice | null = null;

  private noticeSeq = 0;

  private autoTakeoverNotified = false;

  private initialLayout: Map<string, Point>;

  private resizeObserver: ResizeObserver | null = null;

  private frameCount = 0;

  private fpsWindowStart = 0;

  private measuredFps = 0;

  constructor(canvas: HTMLCanvasElement, graph: GraphModel, callbacks: ExperienceCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not available');
    this.ctx = context;
    this.graph = graph;
    layoutGraph(this.graph);
    this.initialLayout = snapshotPositions(this.graph);
    this.spider = new Spider(140);
    this.syncVisibleNodes();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas);
    this.handleResize();
    this.frameHandle = requestAnimationFrame(this.frame);
    this.publish();
  }

  getUiState(): EngineUiState {
    const demo: DemoUiState = {
      status: this.demoStatus,
      index: this.demoVisited.length,
      total: this.snapshot?.evidenceIds.length ?? 0,
      visited: [...this.demoVisited],
      currentId: this.demoCurrentId,
      stepOnce: this.stepOnce,
    };
    return {
      selectedId: this.selectedId,
      selectedOrigin: this.selectedOrigin,
      targetId: this.targetId,
      phase: this.phase,
      paused: this.paused,
      speed: this.speed,
      mode: this.mode,
      demo,
      camera: { follow: this.followCamera, zoom: Number(this.camera.state.zoom.toFixed(3)) },
      manualVisited: [...this.manualVisited],
      collapsedTopics: [...this.collapsedTopics],
      hoverId: this.hoverId,
      currentEvidenceId: this.currentEvidenceId,
      notice: this.notice,
      reducedMotion: this.reducedMotion,
    };
  }

  getFps(): number {
    return this.measuredFps;
  }

  debugSnapshot(): Record<string, unknown> {
    return {
      initialized: this.initialized,
      phase: this.phase,
      mode: this.mode,
      paused: this.paused,
      camera: { ...this.camera.state },
      viewport: { width: this.width, height: this.height, dpr: this.dpr },
      spider: {
        body: { ...this.spider.body },
        screen: this.camera.worldToScreen(this.spider.body),
        destination: { ...this.spider.destination },
        destinationScreen: this.camera.worldToScreen(this.spider.destination),
        velocity: { ...this.spider.velocity },
        heading: this.spider.heading,
        mode: this.spider.mode,
        target: this.spider.targetNodeId,
        reach: this.spider.reach,
        readActive: this.spider.readActive,
        legs: this.spider.legs.map((leg) => ({
          id: leg.spec.id,
          anchor: leg.anchorId,
          swing: Boolean(leg.swing),
          extension: leg.extension,
          contactAt: leg.contactAt,
          contactNodeId: leg.contactNodeId,
          foot: this.spider.getFootWorld(leg),
        })),
      },
      nodes: this.visibleNodes.map((node) => ({
        id: node.id,
        title: node.title,
        kind: node.kind,
        world: { x: node.x, y: node.y },
        screen: this.camera.worldToScreen({ x: node.x, y: node.y }),
      })),
    };
  }

  startSearch(snapshot: SearchSnapshot): void {
    this.snapshot = snapshot;
    this.paused = false;
    this.mode = 'auto';
    this.demoVisited = [];
    this.demoOrder = [];
    this.demoStatus = 'idle';
    this.demoCurrentId = null;
    this.stepOnce = false;
    this.autoWaiting = false;
    this.autoWaitElapsed = 0;
    this.readingSource = null;
    this.readingElapsed = 0;
    this.currentEvidenceId = null;
    this.manualVisited.clear();
    this.autoTakeoverNotified = false;
    this.expandEvidenceTopics();
    this.selectedId = null;
    this.selectedOrigin = null;
    this.targetId = null;
    this.demoOrder = this.planDemoRoute(snapshot.evidenceIds);

    if (!snapshot.evidenceIds.length) {
      this.demoStatus = 'complete';
      this.phase = 'stopped';
      this.spider.stopMovement('本次查询没有匹配证据');
      this.targetId = null;
      this.notice = {
        id: ++this.noticeSeq,
        text:
          snapshot.totalMatches === 0
            ? '没有找到匹配证据，蜘蛛留在原地，未生成任何虚构节点。'
            : '可展示证据为空，蜘蛛留在原地。',
        tone: 'warn',
      };
      this.publish();
      return;
    }

    this.demoStatus = 'running';
    this.startAutoEvidence(this.demoOrder[0] ?? snapshot.evidenceIds[0]);
  }

  clearSearch(): void {
    this.snapshot = null;
    this.demoVisited = [];
    this.demoOrder = [];
    this.demoStatus = 'idle';
    this.demoCurrentId = null;
    this.stepOnce = false;
    this.autoWaiting = false;
    this.currentEvidenceId = null;
    this.readingSource = null;
    this.readingElapsed = 0;
    this.mode = 'manual';
    this.publish();
  }

  announce(text: string, tone: 'info' | 'warn' = 'info'): void {
    this.notice = { id: ++this.noticeSeq, text, tone };
    this.publish();
  }

  selectNode(nodeId: string): boolean {
    const node = this.graph.byId.get(nodeId);
    if (!node) {
      this.notice = { id: ++this.noticeSeq, text: '目标节点已不存在。', tone: 'warn' };
      this.publish();
      return false;
    }
    if (this.collapsedTopics.has(node.topicId) && node.kind !== 'topic') {
      this.collapsedTopics.delete(node.topicId);
      this.syncVisibleNodes();
    }
    if (this.demoStatus === 'running') {
      this.pauseForManualTakeover();
    }
    this.mode = 'manual';
    this.activeTargetOrigin = 'manual';
    this.readingSource = null;
    this.readingElapsed = 0;
    this.autoWaiting = false;
    this.selectedId = node.id;
    this.selectedOrigin = 'user';
    this.targetId = node.id;
    this.phase = 'traveling';
    this.currentEvidenceId = null;
    const result = this.spider.moveToNode(node.id);
    if (!result.ok) {
      this.handleUnreachable(node.id, result.reason ?? '目标不可达');
      return false;
    }
    this.publish();
    this.callbacks.onUserSelect?.(node.id);
    return true;
  }

  clearSelection(): void {
    this.selectedId = null;
    this.selectedOrigin = null;
    this.callbacks.onBlankClick?.();
    this.publish();
  }

  togglePaused(): void {
    this.setPaused(!this.paused);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.publish();
  }

  setSpeed(speed: number): void {
    const closest = SPEEDS.reduce(
      (best, candidate) => (Math.abs(candidate - speed) < Math.abs(best - speed) ? candidate : best),
      1,
    );
    this.speed = closest;
    this.publish();
  }

  stopMovement(): void {
    const wasMoving =
      this.phase === 'traveling' ||
      this.phase === 'settling' ||
      this.phase === 'reading' ||
      this.phase === 'dragging';
    this.demoStatus = this.demoStatus === 'running' ? 'paused' : this.demoStatus;
    this.stepOnce = false;
    this.targetId = null;
    this.readingSource = null;
    this.readingElapsed = 0;
    this.autoWaiting = false;
    this.spider.stopMovement('移动已停止');
    if (wasMoving) this.phase = 'stopped';
    this.notice = {
      id: ++this.noticeSeq,
      text: wasMoving ? '移动已停止，蜘蛛在当前支撑点附近减速落足。' : '蜘蛛当前未在移动。',
      tone: 'info',
    };
    this.publish();
  }

  toggleTopic(topicId: string): void {
    const topicNode = this.graph.byId.get(topicId);
    if (!topicNode || topicNode.kind !== 'topic') return;
    const willCollapse = !this.collapsedTopics.has(topicId);
    if (willCollapse) this.collapsedTopics.add(topicId);
    else this.collapsedTopics.delete(topicId);
    this.syncVisibleNodes();

    if (willCollapse) {
      const target = this.targetId ? this.graph.byId.get(this.targetId) : null;
      const selected = this.selectedId ? this.graph.byId.get(this.selectedId) : null;
      const targetHidden = Boolean(target && target.kind !== 'topic' && target.topicId === topicId);
      if (targetHidden) {
        if (this.demoStatus === 'running') this.demoStatus = 'paused';
        this.mode = 'manual';
        this.targetId = null;
        this.phase = 'blocked';
        this.readingSource = null;
        this.autoWaiting = false;
        this.spider.cancelTarget('目标所在主题已收拢');
        this.notice = {
          id: ++this.noticeSeq,
          text: '目标所在主题已收拢，蜘蛛在最近有效位置平滑停驻，不跳到隐藏节点。',
          tone: 'warn',
        };
      }
      if (selected && selected.kind !== 'topic' && selected.topicId === topicId) {
        this.selectedId = null;
        this.selectedOrigin = null;
      }
      if (!targetHidden && this.demoStatus === 'running' && this.targetId === null) {
        this.demoStatus = 'paused';
      }
    }
    this.publish();
  }

  stepDemo(): void {
    if (!this.snapshot || !this.snapshot.evidenceIds.length) return;
    this.expandEvidenceTopics();
    if (this.demoStatus === 'complete' && this.demoVisited.length >= this.demoOrder.length) {
      this.notice = {
        id: ++this.noticeSeq,
        text: '本轮证据已全部读取，可使用重播重新演示。',
        tone: 'info',
      };
      this.publish();
      return;
    }
    this.stepOnce = true;
    this.paused = false;
    if (this.demoStatus === 'paused' || this.mode === 'manual') {
      this.resumeDemoInternal(true);
    } else {
      this.demoStatus = 'running';
      this.mode = 'auto';
      this.publish();
    }
  }

  replayDemo(): void {
    if (!this.snapshot || !this.snapshot.evidenceIds.length) return;
    this.expandEvidenceTopics();
    this.paused = false;
    this.mode = 'auto';
    this.demoVisited = [];
    this.demoCurrentId = null;
    this.stepOnce = false;
    this.readingSource = null;
    this.readingElapsed = 0;
    this.autoWaiting = false;
    this.currentEvidenceId = null;
    this.demoStatus = 'running';
    this.notice = {
      id: ++this.noticeSeq,
      text: '重播使用同一份检索快照与巡读顺序，不重新执行检索。',
      tone: 'info',
    };
    this.expandEvidenceTopics();
    if (!this.demoOrder.length) this.demoOrder = this.planDemoRoute(this.snapshot.evidenceIds);
    this.startAutoEvidence(this.demoOrder[0] ?? this.snapshot.evidenceIds[0]);
  }

  resumeDemo(): void {
    if (!this.snapshot || !this.snapshot.evidenceIds.length) return;
    if (this.demoStatus === 'complete') {
      this.notice = {
        id: ++this.noticeSeq,
        text: '本轮自动演示已完成，可点击重播。',
        tone: 'info',
      };
      this.publish();
      return;
    }
    this.expandEvidenceTopics();
    this.stepOnce = false;
    this.resumeDemoInternal(false);
  }

  private resumeDemoInternal(stepOnce: boolean): void {
    if (!this.snapshot || !this.snapshot.evidenceIds.length) return;
    const next =
      this.demoOrder.find((id) => !this.demoVisited.includes(id)) ??
      this.snapshot.evidenceIds.find((id) => !this.demoVisited.includes(id));
    if (!next) {
      this.demoStatus = 'complete';
      this.mode = 'auto';
      this.stepOnce = false;
      this.publish();
      return;
    }
    this.mode = 'auto';
    this.demoStatus = 'running';
    this.paused = false;
    this.stepOnce = stepOnce;
    this.autoTakeoverNotified = false;
    this.autoWaiting = false;
    this.readingSource = null;
    this.readingElapsed = 0;
    this.notice = {
      id: ++this.noticeSeq,
      text: '从蜘蛛当前位置重新规划剩余证据路线。',
      tone: 'info',
    };
    this.startAutoEvidence(next);
    this.publish();
  }

  setMode(mode: 'manual' | 'auto'): void {
    if (mode === this.mode) return;
    if (mode === 'manual') {
      if (this.demoStatus === 'running') {
        this.demoStatus = 'paused';
        this.activeTargetOrigin = 'manual';
        this.readingSource = this.readingSource === 'auto' ? 'manual' : this.readingSource;
        this.autoWaiting = false;
        this.notice = {
          id: ++this.noticeSeq,
          text: '已切换到手动探索，自动回放暂停。',
          tone: 'info',
        };
      }
      this.mode = 'manual';
    } else {
      this.mode = 'auto';
      this.notice = this.snapshot
        ? {
            id: ++this.noticeSeq,
            text: '自动回放已暂停，如需继续请点击「继续自动演示」。',
            tone: 'info',
          }
        : {
            id: ++this.noticeSeq,
            text: '输入问题并开始检索，蜘蛛会自动规划并读取证据。',
            tone: 'info',
          };
    }
    this.publish();
  }

  fitView(animated = true): void {
    this.cameraTouched = true;
    this.disableFollowForManualCamera();
    this.camera.fit(graphBounds(this.graph), {
      padding: this.width < 720 ? 48 : 88,
      rightInset: this.panelInset,
      animated,
      minZoom: 0.2,
      maxZoom: 1.25,
    });
    this.publish();
  }

  resetLayout(): void {
    this.sphereAxes = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
    for (const node of this.graph.nodes) {
      const baseline = this.initialLayout.get(node.id);
      if (!baseline) continue;
      node.x = baseline.x;
      node.y = baseline.y;
      node.spatial = baseline.spatial ? { ...baseline.spatial } : undefined;
    }
    for (const topic of this.graph.topics) {
      const topicNode = this.graph.byId.get(topic.id);
      if (topicNode) {
        topic.x = topicNode.x;
        topic.y = topicNode.y;
      }
    }
    this.spider.handleLayoutChange();
    if (this.targetId && this.graph.byId.has(this.targetId)) {
      this.spider.moveToNode(this.targetId);
      this.phase = 'traveling';
    }
    this.notice = {
      id: ++this.noticeSeq,
      text: '节点布局已恢复，检索快照与排序未改变。',
      tone: 'info',
    };
    this.publish();
  }

  setFollowCamera(enabled: boolean): void {
    this.followCamera = enabled;
    this.publish();
  }

  rotateView(yaw: number, pitch: number): void {
    this.pauseForManualTakeover();
    this.disableFollowForManualCamera();
    rotateGraph(this.graph, yaw, pitch);
    this.sphereAxes = this.sphereAxes.map(axis => rotateSpatialPoint(axis, yaw, pitch));
    this.spider.handleLayoutChange();
    if (this.targetId && this.graph.byId.has(this.targetId)) {
      this.readingSource = null;
      this.readingElapsed = 0;
      this.spider.moveToNode(this.targetId);
      this.phase = 'traveling';
      this.activeTargetOrigin = 'manual';
    }
    this.publish();
  }

  toggleFollowCamera(): void {
    this.setFollowCamera(!this.followCamera);
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    if (enabled && this.followCamera) this.followCamera = false;
    this.publish();
  }

  setPanelInset(inset: number): void {
    this.panelInset = Math.max(0, inset);
  }

  dismissNotice(): void {
    if (!this.notice) return;
    this.notice = null;
    this.publish();
  }

  updateGraph(graph: GraphModel, options: { fitAfter?: boolean; clearSelection?: boolean } = {}): void {
    const preserve = snapshotPositions(this.graph);
    const oldBaseline = this.initialLayout;
    layoutGraph(graph, { preserve });
    for (const node of graph.nodes) {
      if (!oldBaseline.has(node.id)) oldBaseline.set(node.id, snapshotPositions(graph).get(node.id)!);
    }
    this.initialLayout = oldBaseline;
    this.graph = graph;
    this.syncVisibleNodes();

    if (this.demoStatus === 'running') {
      this.demoStatus = 'paused';
      this.stepOnce = false;
      this.mode = 'manual';
      if (this.activeTargetOrigin === 'auto') {
        this.readingSource = null;
        this.readingElapsed = 0;
        this.autoWaiting = false;
        this.targetId = null;
        this.phase = 'stopped';
        this.spider.stopMovement('知识库已更新，自动演示暂停');
      }
    }

    if (options.clearSelection) {
      this.selectedId = null;
      this.selectedOrigin = null;
    }
    if (this.targetId && !this.graph.byId.has(this.targetId)) {
      this.handleTargetUnavailable('目标已从知识网络中删除，蜘蛛在最近有效位置平滑停驻。');
    }
    if (this.selectedId && !this.graph.byId.has(this.selectedId)) {
      this.selectedId = null;
      this.selectedOrigin = null;
    }
    if (this.snapshot) {
      const missingEvidence = this.snapshot.evidenceIds.some((id) => !this.graph.byId.has(id));
      if (missingEvidence) {
        this.demoStatus = 'paused';
        this.interactionDragging = false;
        this.spider.stopMovement('检索快照中的证据已被移除');
        this.notice = {
          id: ++this.noticeSeq,
          text: '检索快照引用的资料已被移除，自动演示暂停。',
          tone: 'warn',
        };
      }
    }
    if (options.fitAfter) {
      this.camera.fit(graphBounds(this.graph), {
        padding: this.width < 720 ? 48 : 88,
        rightInset: this.panelInset,
        animated: true,
      });
    }
    this.publish();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }

  private publish(): void {
    if (this.destroyed) return;
    this.callbacks.onState(this.getUiState());
  }

  private syncVisibleNodes(): void {
    const next = this.graph.nodes.filter(
      (node) => node.kind === 'topic' || !this.collapsedTopics.has(node.topicId),
    );
    this.visibleNodes = next;
    this.spider.setNodes(next);
  }

  private handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    if (width < 40 || height < 40) return;
    const pixelBudget = Math.sqrt(8_000_000 / (width * height));
    const dpr = Math.max(1, Math.min(3, Math.max(2, window.devicePixelRatio || 1), pixelBudget));
    const sizeChanged = Math.abs(width - this.width) > 0.5 || Math.abs(height - this.height) > 0.5;
    if (!sizeChanged && this.initialized && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.camera.setViewport(width, height);

    if (!this.initialized) {
      this.initializeScene();
    } else if (!this.cameraTouched && !this.instantiatedActive()) {
      this.camera.fit(graphBounds(this.graph), {
        padding: width < 720 ? 46 : 86,
        rightInset: this.panelInset,
        animated: false,
      });
    }
  }

  private instantiatedActive(): boolean {
    return this.phase !== 'idle' || this.demoStatus === 'running' || this.camera.isAnimating;
  }

  private initializeScene(): void {
    this.camera.fit(graphBounds(this.graph), {
      padding: this.width < 720 ? 46 : 88,
      rightInset: 0,
      animated: false,
      minZoom: 0.2,
      maxZoom: 1.25,
    });
    this.initialZoom = this.camera.state.zoom;
    const reach = clamp((this.width * 0.27) / (2 * this.initialZoom), 150, 220);
    this.spider.setReach(reach);
    this.syncVisibleNodes();
    const bounds = graphBounds(this.graph);
    this.spider.initialize(
      this.visibleNodes,
      { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    );
    this.phase = 'idle';
    this.initialized = true;
    this.attachCanvasEvents();
    this.emitInitialState();
  }

  private emitInitialState(): void {
    this.publish();
  }

  private attachCanvasEvents(): void {
    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  private toLocal(event: PointerEvent | WheelEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.initialized || event.button > 0) return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    const local = this.toLocal(event);
    this.pointerState[event.pointerId] = local;

    if (event.shiftKey && Object.keys(this.pointerState).length === 1) {
      this.gesture = { mode: 'orbit', previous: local };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (Object.keys(this.pointerState).length === 2) {
      if (this.gesture?.mode === 'node-drag') this.finishNodeDrag();
      if (this.gesture?.mode === 'body-drag') this.finishBodyDrag();
      const ids = Object.keys(this.pointerState).map(Number);
      const points = ids.map((id) => this.pointerState[id]);
      this.gesture = {
        mode: 'pinch',
        pointerIds: ids,
        previousDistance: worldDistance(points[0], points[1]) || 1,
        previousMid: {
          x: (points[0].x + points[1].x) / 2,
          y: (points[0].y + points[1].y) / 2,
        },
      };
      this.disableFollowForManualCamera();
      return;
    }

    const toggle = hitTopicToggle(this.visibleNodes, this.camera, local);
    if (toggle) {
      this.gesture = {
        mode: 'pending',
        kind: 'toggle',
        start: local,
        current: local,
        nodeId: toggle.id,
        moved: false,
      };
      this.canvas.style.cursor = 'pointer';
      return;
    }

    const hit = hitNode(this.visibleNodes, this.camera, local);
    if (hit) {
      this.gesture = {
        mode: 'pending',
        kind: 'node',
        start: local,
        current: local,
        nodeId: hit.id,
        moved: false,
      };
      this.canvas.style.cursor = 'grab';
      return;
    }

    if (hitSpiderBody(this.camera, this.spider.body, local)) {
      this.gesture = {
        mode: 'pending',
        kind: 'body',
        start: local,
        current: local,
        moved: false,
      };
      this.canvas.style.cursor = 'grab';
      return;
    }

    this.gesture = { mode: 'pending', kind: 'blank', start: local, current: local, moved: false };
    this.canvas.style.cursor = 'grab';
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.initialized) return;
    const local = this.toLocal(event);
    if (this.pointerState[event.pointerId]) this.pointerState[event.pointerId] = local;
    if (this.gesture?.mode === 'pinch') {
      const points = this.gesture.pointerIds
        .map((id) => this.pointerState[id])
        .filter((point): point is Point => Boolean(point));
      if (points.length < 2) return;
      const distance = worldDistance(points[0], points[1]) || 1;
      const mid = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const factor = distance / (this.gesture.previousDistance || 1);
      this.camera.zoomAt(mid, factor);
      this.camera.panBy(mid.x - this.gesture.previousMid.x, mid.y - this.gesture.previousMid.y);
      this.gesture.previousDistance = distance;
      this.gesture.previousMid = mid;
      this.disableFollowForManualCamera();
      return;
    }

    if (!this.gesture) {
      this.updateHover(local);
      return;
    }

    if (this.gesture.mode === 'orbit') {
      const previous = this.gesture.previous;
      this.gesture.previous = local;
      this.rotateView((local.x - previous.x) * 0.005, (local.y - previous.y) * 0.005);
      return;
    }

    if (this.gesture.mode === 'pending') {
      const distance = worldDistance(local, this.gesture.start);
      if (distance < CLICK_THRESHOLD) {
        this.gesture.current = local;
        return;
      }
      this.gesture.moved = true;
      if (this.gesture.kind === 'blank') {
        const panGesture: Gesture = {
          mode: 'pan',
          start: this.gesture.start,
          previous: this.gesture.start,
          moved: true,
        };
        this.gesture = panGesture;
        this.canvas.style.cursor = 'grabbing';
        this.disableFollowForManualCamera();
        return;
      }
      if (this.gesture.kind === 'node' && this.gesture.nodeId) {
        const node = this.graph.byId.get(this.gesture.nodeId);
        if (node) {
          this.beginNodeDrag(this.gesture.nodeId, this.gesture.start);
        }
        return;
      }
      if (this.gesture.kind === 'body') {
        this.beginBodyDrag(this.gesture.start);
        return;
      }
      return;
    }

    if (this.gesture.mode === 'pan') {
      const dx = local.x - this.gesture.previous.x;
      const dy = local.y - this.gesture.previous.y;
      this.camera.panBy(dx, dy);
      this.gesture.previous = local;
      this.gesture.moved = true;
      return;
    }

    if (this.gesture.mode === 'node-drag') {
      this.moveNodeDrag(local);
      return;
    }

    if (this.gesture.mode === 'body-drag') {
      const world = this.camera.screenToWorld(local);
      const bounds = graphBounds(this.graph);
      const clamped = {
        x: clamp(world.x, bounds.minX - 240, bounds.maxX + 240),
        y: clamp(world.y, bounds.minY - 240, bounds.maxY + 240),
      };
      this.spider.dragBodyTo(clamped);
      this.phase = 'dragging';
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    delete this.pointerState[event.pointerId];
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (!this.gesture) return;

    if (this.gesture.mode === 'pinch') {
      if (Object.keys(this.pointerState).length < 2) {
        this.gesture = null;
        if (Object.keys(this.pointerState).length === 0) this.canvas.style.cursor = 'grab';
      }
      return;
    }

    if (this.gesture.mode === 'pending') {
      if (!this.gesture.moved) {
        if (this.gesture.kind === 'node' && this.gesture.nodeId) {
          this.pickNodeFromCanvas(this.gesture.nodeId);
        } else if (this.gesture.kind === 'toggle' && this.gesture.nodeId) {
          this.toggleTopic(this.gesture.nodeId);
        } else if (this.gesture.kind === 'blank') {
          this.clearSelection();
        }
      }
      this.gesture = null;
      this.canvas.style.cursor = 'grab';
      return;
    }

    if (this.gesture.mode === 'node-drag') {
      this.finishNodeDrag();
      this.gesture = null;
      this.canvas.style.cursor = 'grab';
      return;
    }

    if (this.gesture.mode === 'body-drag') {
      this.finishBodyDrag();
      this.gesture = null;
      this.canvas.style.cursor = 'grab';
      return;
    }

    this.gesture = null;
    this.canvas.style.cursor = 'grab';
  };

  private handlePointerLeave = (): void => {
    if (!this.gesture) {
      this.hoverId = null;
      this.canvas.style.cursor = 'default';
      this.publish();
    }
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (!this.initialized) return;
    const local = this.toLocal(event);
    const factor = Math.exp(-event.deltaY * 0.00115);
    this.camera.zoomAt(local, factor);
    this.disableFollowForManualCamera();
    this.updateHover(local);
  };

  private updateHover(local: Point): void {
    const toggle = hitTopicToggle(this.visibleNodes, this.camera, local);
    const hit = toggle ? null : hitNode(this.visibleNodes, this.camera, local);
    const overSpider = !toggle && !hit && hitSpiderBody(this.camera, this.spider.body, local);
    const nextHover = hit?.id ?? null;
    this.canvas.style.cursor = toggle || hit || overSpider ? 'pointer' : 'grab';
    if (nextHover !== this.hoverId) {
      this.hoverId = nextHover;
      this.publish();
    }
  }

  private disableFollowForManualCamera(): void {
    this.cameraTouched = true;
    if (!this.followCamera) return;
    this.followCamera = false;
    this.publish();
  }

  private pickNodeFromCanvas(nodeId: string): void {
    this.selectNode(nodeId);
  }

  private pauseForManualTakeover(): void {
    if (this.demoStatus !== 'running' && this.demoStatus !== 'paused') return;
    this.demoStatus = 'paused';
    this.mode = 'manual';
    this.activeTargetOrigin = 'manual';
    this.autoWaiting = false;
    this.stepOnce = false;
    if (!this.autoTakeoverNotified) {
      this.autoTakeoverNotified = true;
      this.notice = {
        id: ++this.noticeSeq,
        text: '自动演示已暂停，进入手动探索。点击「继续自动演示」可恢复。',
        tone: 'info',
      };
    }
  }

  private beginNodeDrag(nodeId: string, startScreen: Point): void {
    const node = this.graph.byId.get(nodeId);
    if (!node) return;
    this.pauseForManualTakeover();
    this.interactionDragging = true;
    this.phase = 'dragging';
    const startPositions = new Map<string, Point>();
    if (node.kind === 'topic') {
      for (const member of this.graph.nodes.filter((entry) => entry.topicId === node.id)) {
        startPositions.set(member.id, { x: member.x, y: member.y });
      }
      startPositions.set(node.id, { x: node.x, y: node.y });
    } else {
      startPositions.set(node.id, { x: node.x, y: node.y });
    }
    this.readingSource = null;
    this.readingElapsed = 0;
    this.autoWaiting = false;
    this.mode = 'manual';
    this.gesture = {
      mode: 'node-drag',
      nodeId,
      start: startScreen,
      startPositions,
    };
    this.canvas.style.cursor = 'move';
    this.cameraTouched = true;
    this.publish();
  }

  private moveNodeDrag(local: Point): void {
    if (!this.gesture || this.gesture.mode !== 'node-drag') return;
    const node = this.graph.byId.get(this.gesture.nodeId);
    if (!node) return;
    const start = this.gesture.start;
    const zoom = this.camera.state.zoom;
    const dx = (local.x - start.x) / zoom;
    const dy = (local.y - start.y) / zoom;
    if (node.kind === 'topic') {
      for (const [id, original] of this.gesture.startPositions) {
        const member = this.graph.byId.get(id);
        if (!member) continue;
        member.x = original.x + dx;
        member.y = original.y + dy;
      }
    } else {
      const original = this.gesture.startPositions.get(node.id);
      if (!original) return;
      const unclamped = { x: original.x + dx, y: original.y + dy };
      node.x = unclamped.x;
      node.y = unclamped.y;
    }
    for (const id of this.gesture.startPositions.keys()) {
      const moved = this.graph.byId.get(id);
      if (moved) syncSpatialPosition(moved);
    }
    if (node.kind === 'topic') {
      const topic = this.graph.topics.find((entry) => entry.id === node.id);
      if (topic) { topic.x = node.x; topic.y = node.y; }
    }
    this.spider.handleLayoutChange();
  }

  private finishNodeDrag(): void {
    this.interactionDragging = false;
    this.cameraTouched = true;
    const targetExists = this.targetId ? this.graph.byId.has(this.targetId) : false;
    if (targetExists && this.targetId) {
      this.spider.moveToNode(this.targetId);
      this.phase = 'traveling';
      this.activeTargetOrigin = 'manual';
    } else {
      this.spider.handleLayoutChange();
      if (this.phase === 'dragging') this.phase = 'idle';
    }
    this.notice = {
      id: ++this.noticeSeq,
      text: '布局已调整，检索结果和排序保持不变。蜘蛛将从当前位置重新规划。',
      tone: 'info',
    };
    this.publish();
  }

  private beginBodyDrag(startScreen: Point): void {
    this.pauseForManualTakeover();
    this.mode = 'manual';
    this.interactionDragging = true;
    this.spider.beginBodyDrag();
    this.phase = 'dragging';
    this.canvas.style.cursor = 'move';
    this.gesture = {
      mode: 'body-drag',
      start: startScreen,
    };
    this.readingSource = null;
    this.readingElapsed = 0;
    this.autoWaiting = false;
    this.publish();
  }

  private finishBodyDrag(): void {
    this.interactionDragging = false;
    this.spider.endBodyDrag();
    const hadTarget = this.targetId && this.graph.byId.has(this.targetId);
    if (hadTarget && this.targetId) {
      this.spider.moveToNode(this.targetId);
      this.phase = 'traveling';
      this.activeTargetOrigin = 'manual';
    } else {
      this.phase = 'settling';
    }
    this.mode = 'manual';
    this.notice = {
      id: ++this.noticeSeq,
      text: '蜘蛛已从拖动位置重新规划支撑点，不跳回旧位置。',
      tone: 'info',
    };
    this.publish();
  }

  private expandEvidenceTopics(): void {
    if (!this.snapshot) return;
    let changed = false;
    for (const evidenceId of this.snapshot.evidenceIds) {
      const node = this.graph.byId.get(evidenceId);
      if (!node) continue;
      if (this.collapsedTopics.delete(node.topicId)) changed = true;
    }
    if (changed) this.syncVisibleNodes();
  }

  private planDemoRoute(evidenceIds: string[]): string[] {
    const remaining = evidenceIds.filter((id) => {
      const node = this.graph.byId.get(id);
      return Boolean(node && !(node.kind !== 'topic' && this.collapsedTopics.has(node.topicId)));
    });
    if (remaining.length < 2) return remaining;
    const order: string[] = [];
    let cursor = { ...this.spider.body };
    while (remaining.length) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < remaining.length; index += 1) {
        const node = this.graph.byId.get(remaining[index]);
        if (!node) continue;
        const distance = worldDistance(cursor, { x: node.x, y: node.y });
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      const [next] = remaining.splice(bestIndex, 1);
      if (!next) break;
      order.push(next);
      const node = this.graph.byId.get(next);
      if (node) cursor = { x: node.x, y: node.y };
    }
    return order;
  }

  private startAutoEvidence(nodeId: string): void {
    const node = this.graph.byId.get(nodeId);
    if (!node || (this.collapsedTopics.has(node.topicId) && node.kind !== 'topic')) {
      this.handleTargetUnavailable('自动演示目标已隐藏或删除，蜘蛛在最近有效位置停驻。');
      return;
    }
    this.mode = 'auto';
    this.demoStatus = 'running';
    this.demoCurrentId = node.id;
    this.selectedId = node.id;
    this.selectedOrigin = 'auto';
    this.targetId = node.id;
    this.activeTargetOrigin = 'auto';
    this.readingSource = null;
    this.readingElapsed = 0;
    this.currentEvidenceId = null;
    this.autoWaiting = false;
    this.phase = 'traveling';
    const result = this.spider.moveToNode(node.id);
    if (!result.ok) {
      this.handleUnreachable(node.id, result.reason ?? '自动演示目标不可达');
      return;
    }
    this.publish();
  }

  private handleUnreachable(nodeId: string | null, reason: string): void {
    this.targetId = null;
    this.phase = 'blocked';
    this.demoStatus = this.demoStatus === 'running' ? 'paused' : this.demoStatus;
    this.mode = 'manual';
    this.readingSource = null;
    this.autoWaiting = false;
    this.spider.cancelTarget(reason);
    this.notice = { id: ++this.noticeSeq, text: `${reason}。蜘蛛不会跳到目标位置。`, tone: 'warn' };
    if (nodeId !== null) this.selectedId = this.graph.byId.has(nodeId) ? nodeId : null;
    this.publish();
  }

  private handleTargetUnavailable(reason: string): void {
    this.targetId = null;
    this.phase = 'blocked';
    this.demoStatus = this.demoStatus === 'running' ? 'paused' : this.demoStatus;
    this.mode = 'manual';
    this.readingSource = null;
    this.autoWaiting = false;
    this.spider.cancelTarget(reason);
    this.notice = { id: ++this.noticeSeq, text: reason, tone: 'warn' };
    this.publish();
  }

  private completeReading(): void {
    if (this.readingSource === 'auto') {
      const nodeId = this.targetId;
      if (nodeId && !this.demoVisited.includes(nodeId)) this.demoVisited.push(nodeId);
      this.readingSource = null;
      this.readingElapsed = 0;
      this.currentEvidenceId = null;
      if (this.stepOnce) {
        this.stepOnce = false;
        this.demoStatus = 'paused';
        this.paused = true;
        this.phase = 'arrived';
        this.notice = {
          id: ++this.noticeSeq,
          text: '单步完成：已读取一条证据，自动演示暂停。',
          tone: 'info',
        };
        this.publish();
        return;
      }
      if (!this.snapshot || this.demoVisited.length >= this.demoOrder.length) {
        this.demoStatus = 'complete';
        this.phase = 'arrived';
        this.notice = {
          id: ++this.noticeSeq,
          text: '自动检索演示完成，巡读顺序按空间就近编排，结果列表保持检索排名。',
          tone: 'info',
        };
        this.publish();
        return;
      }
      this.demoStatus = 'running';
      this.phase = 'arrived';
      this.autoWaiting = true;
      this.autoWaitElapsed = 0;
      this.publish();
      return;
    }

    if (this.readingSource === 'manual') {
      this.readingSource = null;
      this.readingElapsed = 0;
      this.phase = 'arrived';
      this.publish();
    }
  }

  private advanceAutoBetween(dt: number): void {
    if (!this.autoWaiting) return;
    this.autoWaitElapsed += dt;
    if (this.autoWaitElapsed < AUTO_BETWEEN_DELAY) return;
    this.autoWaiting = false;
    if (!this.snapshot || this.demoStatus !== 'running') return;
    const next =
      this.demoOrder.find((id) => !this.demoVisited.includes(id)) ??
      this.snapshot.evidenceIds.find((id) => !this.demoVisited.includes(id));
    if (!next) {
      this.demoStatus = 'complete';
      this.phase = 'arrived';
      this.publish();
      return;
    }
    this.startAutoEvidence(next);
  }

  private handleSpiderEvents(events: SpiderEvent[]): void {
    for (const event of events) {
      if (event.type === 'contact') {
        continue;
      }
      if (event.type === 'arrived') {
        if (this.phase === 'dragging' || this.interactionDragging) continue;
        if (event.nodeId !== this.targetId) continue;
        const autoArrival =
          this.mode === 'auto' &&
          this.demoStatus === 'running' &&
          this.snapshot?.evidenceIds.includes(event.nodeId) === true &&
          this.activeTargetOrigin === 'auto';
        this.phase = 'reading';
        this.readingElapsed = 0;
        this.readingSource = autoArrival ? 'auto' : 'manual';
        this.currentEvidenceId =
          this.snapshot?.evidenceIds.includes(event.nodeId) ? event.nodeId : null;
        this.targetId = event.nodeId;
        if (!autoArrival) {
          this.manualVisited.add(event.nodeId);
          if (!this.selectedId) {
            this.phase = 'reading';
          }
        } else {
          this.selectedId = event.nodeId;
          this.selectedOrigin = 'auto';
          this.demoCurrentId = event.nodeId;
        }
        this.publish();
        continue;
      }
      if (event.type === 'blocked') {
        if (this.targetId && event.nodeId && event.nodeId !== this.targetId) continue;
        this.handleUnreachable(event.nodeId, event.reason);
        continue;
      }
      if (event.type === 'stopped') {
        if (this.phase === 'blocked') continue;
        if (!this.targetId) this.phase = 'stopped';
        else this.phase = 'idle';
        this.publish();
        continue;
      }
    }
  }

  private updateMotionPhaseFromSpider(): void {
    if (this.interactionDragging || this.readingSource) return;
    if (this.phase === 'blocked' || this.phase === 'stopped') return;
    if (this.spider.mode === 'traveling' && this.phase !== 'traveling') {
      this.phase = 'traveling';
      this.publish();
    } else if (this.spider.mode === 'settling' && this.phase !== 'settling') {
      this.phase = 'settling';
      this.publish();
    }
  }

  private updateCameraFollow(realDt: number): void {
    if (!this.followCamera || this.paused || this.reducedMotion || this.interactionDragging || this.camera.isAnimating) return;
    const focusNode = this.targetId ? this.graph.byId.get(this.targetId) : null;
    if (!focusNode) return;
    const dx = focusNode.x - this.spider.body.x;
    const dy = focusNode.y - this.spider.body.y;
    const distance = Math.hypot(dx, dy) || 1;
    const lookAhead = Math.min(56, distance * 0.18);
    this.camera.followPoint(
      { x: this.spider.body.x + (dx / distance) * lookAhead, y: this.spider.body.y + (dy / distance) * lookAhead },
      realDt,
      {
        rightInset: this.panelInset,
        topInset: this.width < 720 ? 150 : 40,
        bottomInset: this.width < 720 ? 96 : 64,
      },
    );
  }

  private frame = (now: number): void => {
    if (this.destroyed) return;
    if (!this.lastFrame) this.lastFrame = now;
    const realDt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.frameCount += 1;
    if (!this.fpsWindowStart) this.fpsWindowStart = now;
    if (now - this.fpsWindowStart >= 1000) {
      this.measuredFps = Math.round((this.frameCount * 1000) / (now - this.fpsWindowStart));
      this.frameCount = 0;
      this.fpsWindowStart = now;
    }

    if (this.initialized) {
      const scaledDt = this.paused ? 0 : realDt * this.speed;
      this.camera.update(realDt);
      if (!this.interactionDragging) {
        if (scaledDt > 0) {
          this.spider.tick(scaledDt);
          this.handleSpiderEvents(this.spider.consumeEvents());
          if (this.readingSource) {
            this.readingElapsed += scaledDt;
            if (this.readingElapsed >= READ_DURATION) this.completeReading();
          }
          this.advanceAutoBetween(scaledDt);
        }
        this.updateMotionPhaseFromSpider();
      }
      this.updateCameraFollow(realDt);
      this.render();
    }
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private render(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const state: SceneState = {
      graph: this.graph,
      camera: this.camera,
      sphereAxes: this.sphereAxes,
      spider: this.spider,
      selectedId: this.selectedId,
      targetId: this.targetId,
      hoverId: this.hoverId,
      collapsedTopics: this.collapsedTopics,
      snapshot: this.snapshot,
      routeIds:
        this.demoOrder.length > 0
          ? this.demoOrder
          : (this.snapshot?.evidenceIds ?? []),
      visitedEvidenceIds: this.demoVisited,
      currentEvidenceId: this.currentEvidenceId,
      manualVisitedIds: [...this.manualVisited],
      phase: this.phase,
      mode: this.mode,
      paused: this.paused,
      reducedMotion: this.reducedMotion,
      time: this.spider.simTime,
      width: this.width,
      height: this.height,
    };
    renderScene(this.ctx, state);
  }
}
