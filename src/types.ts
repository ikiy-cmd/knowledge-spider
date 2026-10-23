export type NodeKind = 'topic' | 'document' | 'fragment';
export type EdgeKind = 'contains' | 'citation' | 'similarity';

export interface RawFragment {
  id: string;
  title: string;
  text: string;
  keywords: string[];
  cites?: string[];
}

export interface RawDocument {
  id: string;
  title: string;
  source: string;
  format: string;
  summary: string;
  fragments: RawFragment[];
}

export interface RawTopic {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  summary: string;
  docs: RawDocument[];
  imported?: boolean;
}

export interface KnowledgeBase {
  version: string;
  label: string;
  topics: RawTopic[];
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  title: string;
  topicId: string;
  parentId: string | null;
  childIds: string[];
  color: string;
  summary: string;
  content: string;
  source: string;
  keywords: string[];
  x: number;
  y: number;
  spatial?: { x: number; y: number; z: number };
  order: number;
  imported: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
  curated: boolean;
}

export interface TopicRegion {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  summary: string;
  nodeIds: string[];
  imported: boolean;
  x: number;
  y: number;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  byId: Map<string, GraphNode>;
  topics: TopicRegion[];
  version: string;
  label: string;
}

export interface SearchHit {
  rank: number;
  fragmentId: string;
  docId: string;
  topicId: string;
  title: string;
  docTitle: string;
  topicName: string;
  source: string;
  text: string;
  keywords: string[];
  score: number;
}

export interface SearchSnapshot {
  id: number;
  query: string;
  topK: number;
  hits: SearchHit[];
  candidateIds: string[];
  evidenceIds: string[];
  totalMatches: number;
  tokens: string[];
  computeMs: number;
  method: string;
}

export type MotionPhase =
  | 'idle'
  | 'traveling'
  | 'settling'
  | 'reading'
  | 'arrived'
  | 'stopped'
  | 'blocked'
  | 'dragging';

export type DemoTone = 'idle' | 'running' | 'paused' | 'complete';

export interface DemoUiState {
  status: DemoTone;
  index: number;
  total: number;
  visited: string[];
  currentId: string | null;
  stepOnce: boolean;
}

export interface CameraUiState {
  follow: boolean;
  zoom: number;
}

export interface EngineNotice {
  id: number;
  text: string;
  tone: 'info' | 'warn';
}

export interface EngineUiState {
  selectedId: string | null;
  selectedOrigin: 'user' | 'auto' | null;
  targetId: string | null;
  phase: MotionPhase;
  paused: boolean;
  speed: number;
  mode: 'manual' | 'auto';
  demo: DemoUiState;
  camera: CameraUiState;
  manualVisited: string[];
  collapsedTopics: string[];
  hoverId: string | null;
  currentEvidenceId: string | null;
  notice: EngineNotice | null;
  reducedMotion: boolean;
}
