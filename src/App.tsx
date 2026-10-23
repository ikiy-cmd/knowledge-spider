import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, WarningCircle, X } from '@phosphor-icons/react';
import type {
  EngineUiState,
  GraphModel,
  KnowledgeBase,
  SearchSnapshot,
} from './types';
import { sampleKnowledge } from './data/sampleKnowledge';
import { buildGraph } from './graph/buildGraph';
import { buildRetrievalIndex, createSearchSnapshot } from './lib/search';
import {
  addImportedTopic,
  countKnowledge,
  createImportedTopic,
  removeImportedTopic,
  type ImportDraft,
} from './lib/importKnowledge';
import { Experience } from './engine/Experience';
import { KnowledgeCanvas } from './components/KnowledgeCanvas';
import { TopBar } from './components/TopBar';
import { MissionHud } from './components/MissionHud';
import { Legend } from './components/Legend';
import { TransportBar } from './components/TransportBar';
import { SidePanel, type PanelTab } from './components/SidePanel';
import { ImportDialog } from './components/ImportDialog';
import { SpatialControls } from './components/SpatialControls';

const INITIAL_UI: EngineUiState = {
  selectedId: null,
  selectedOrigin: null,
  targetId: null,
  phase: 'idle',
  paused: false,
  speed: 1,
  mode: 'manual',
  demo: {
    status: 'idle',
    index: 0,
    total: 0,
    visited: [],
    currentId: null,
    stepOnce: false,
  },
  camera: { follow: true, zoom: 0.7 },
  manualVisited: [],
  collapsedTopics: [],
  hoverId: null,
  currentEvidenceId: null,
  notice: null,
  reducedMotion: false,
};

function AppToast({
  ui,
  onDismiss,
}: {
  ui: EngineUiState;
  onDismiss: () => void;
}) {
  if (!ui.notice) return null;
  const Icon = ui.notice.tone === 'warn' ? WarningCircle : Info;
  return (
    <div
      className={`app-toast${ui.notice.tone === 'warn' ? ' is-warn' : ''}`}
      role="status"
      key={ui.notice.id}
      data-testid="app-toast"
    >
      <Icon size={16} weight="regular" aria-hidden="true" />
      <p>{ui.notice.text}</p>
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="关闭提示">
        <X size={13} weight="regular" />
      </button>
    </div>
  );
}

export default function App() {
  const [kb, setKb] = useState<KnowledgeBase>(sampleKnowledge);
  const [graphRevision, setGraphRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(5);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SearchSnapshot | null>(null);
  const [ui, setUi] = useState<EngineUiState>(INITIAL_UI);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('results');
  const [importOpen, setImportOpen] = useState(false);
  const engineRef = useRef<Experience | null>(null);
  const searchSeqRef = useRef(0);

  const graph: GraphModel = useMemo(() => buildGraph(kb), [kb]);
  const retrievalIndex = useMemo(() => buildRetrievalIndex(kb), [kb]);
  const counts = useMemo(() => countKnowledge(kb), [kb]);
  const selectedNode = ui.selectedId ? graph.byId.get(ui.selectedId) ?? null : null;
  const autoPaused =
    ui.demo.status === 'paused' || (ui.paused && ui.demo.status === 'running');

  const applyPanelInset = useCallback(() => {
    const inset = panelOpen && window.innerWidth >= 980 ? 412 : 0;
    engineRef.current?.setPanelInset(inset);
  }, [panelOpen]);

  useEffect(() => {
    applyPanelInset();
    window.addEventListener('resize', applyPanelInset);
    return () => window.removeEventListener('resize', applyPanelInset);
  }, [applyPanelInset]);

  useEffect(() => {
    if (!ui.notice) return;
    const timer = window.setTimeout(() => {
      engineRef.current?.dismissNotice();
    }, 5600);
    return () => window.clearTimeout(timer);
  }, [ui.notice]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (importOpen) {
          setImportOpen(false);
          return;
        }
        if (panelOpen) setPanelOpen(false);
        return;
      }
      if (event.key === '/' && !importOpen) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
          return;
        }
        event.preventDefault();
        document.getElementById('query-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [importOpen, panelOpen]);

  useEffect(() => {
    if (!importOpen) return;
    const modal = document.querySelector<HTMLElement>('.import-dialog');
    modal?.focus();
  }, [importOpen]);

  const runSearch = (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      setQueryError('请输入一个问题，再让蜘蛛沿网检索。');
      document.getElementById('query-input')?.focus();
      return;
    }
    if (!engineRef.current) {
      setQueryError('画布仍在准备，请稍后再试。');
      return;
    }
    setQuery(rawQuery);
    setQueryError(null);
    const id = (searchSeqRef.current += 1);
    const nextSnapshot = createSearchSnapshot(retrievalIndex, trimmed, topK, id);
    setSnapshot(nextSnapshot);
    setActiveTab('results');
    setPanelOpen(true);
    engineRef.current.startSearch(nextSnapshot);
  };

  const handleImport = (draft: ImportDraft): string | null => {
    try {
      const topic = createImportedTopic(draft, kb);
      const nextKb = addImportedTopic(kb, topic);
      setKb(nextKb);
      setGraphRevision((value) => value + 1);
      setImportOpen(false);
      setQueryError(null);
      const fragments = topic.docs[0]?.fragments.length ?? 0;
      engineRef.current?.announce(
        `已加入「${topic.name}」：1 篇文档、${fragments} 个片段。检索索引已更新，下一次查询生效。`,
        'info',
      );
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '导入失败，请检查文本格式。';
    }
  };

  const handleRemoveImported = (topicId: string) => {
    const topic = kb.topics.find((entry) => entry.id === topicId);
    if (!topic) return;
    const removedIds = new Set(
      graph.nodes.filter((node) => node.topicId === topicId).map((node) => node.id),
    );
    const selectedRemoved = Boolean(ui.selectedId && removedIds.has(ui.selectedId));
    const searchInvalidated = Boolean(
      snapshot && snapshot.hits.some((hit) => removedIds.has(hit.fragmentId)),
    );
    const nextKb = removeImportedTopic(kb, topicId);
    if (searchInvalidated) {
      setSnapshot(null);
      engineRef.current?.clearSearch();
    }
    setKb(nextKb);
    setGraphRevision((value) => value + 1);
    if (selectedRemoved) {
      setPanelOpen(false);
      setActiveTab('results');
    } else if (searchInvalidated) {
      setActiveTab('results');
    }
    engineRef.current?.announce(
      searchInvalidated
        ? `已移除「${topic.name}」，检索索引已重建，引用了被删来源的结果快照已清空。`
        : `已移除「${topic.name}」，检索索引已重建。当前结果快照未被改动。`,
      'warn',
    );
  };

  const openPanel = () => {
    if (!selectedNode && activeTab === 'detail' && snapshot) setActiveTab('results');
    setPanelOpen(true);
  };

  const handleTabChange = (tab: PanelTab) => {
    setActiveTab(tab);
    setPanelOpen(true);
  };

  const selectNodeFromUi = (nodeId: string) => {
    setActiveTab('detail');
    setPanelOpen(true);
    engineRef.current?.selectNode(nodeId);
  };

  const handleCanvasUserSelect = (_nodeId: string) => {
    setActiveTab('detail');
    setPanelOpen(true);
  };

  const handleBlankClick = () => {
    if (activeTab === 'detail') setPanelOpen(false);
  };

  const handleModeChange = (mode: 'manual' | 'auto') => {
    engineRef.current?.setMode(mode);
    if (mode === 'auto') {
      setActiveTab('results');
      setPanelOpen(true);
      if (!snapshot) {
        window.setTimeout(() => document.getElementById('query-input')?.focus(), 0);
      }
    }
  };

  const handleResumeAuto = () => {
    setActiveTab('results');
    setPanelOpen(true);
    engineRef.current?.resumeDemo();
  };

  const handleReplay = () => {
    setActiveTab('results');
    setPanelOpen(true);
    engineRef.current?.replayDemo();
  };

  const handleStep = () => {
    setActiveTab('results');
    setPanelOpen(true);
    engineRef.current?.stepDemo();
  };

  const handleEngineReady = useCallback((engine: Experience) => {
    engineRef.current = engine;
    applyPanelInset();
  }, [applyPanelInset]);

  const openSelectedDetails = () => {
    if (selectedNode) {
      setActiveTab('detail');
      setPanelOpen(true);
    }
  };

  return (
    <div
      className="app-shell"
      data-reduced-motion={ui.reducedMotion ? 'true' : 'false'}
      data-mode={ui.mode}
      data-phase={ui.phase}
      data-panel-open={panelOpen ? 'true' : 'false'}
      data-testid="knowledge-app"
    >
      <TopBar
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          if (queryError) setQueryError(null);
        }}
        onSubmit={() => runSearch(query)}
        topK={topK}
        onTopKChange={setTopK}
        queryError={queryError}
        mode={ui.mode}
        onModeChange={handleModeChange}
        onOpenImport={() => setImportOpen(true)}
        stats={{ nodes: graph.nodes.length, topics: graph.topics.length }}
        autoPaused={autoPaused}
      />

      <main className={`stage${panelOpen ? ' has-panel' : ''}`} aria-label="知识网络与蜘蛛">
        <KnowledgeCanvas
          graph={graph}
          graphRevision={graphRevision}
          nodeCount={graph.nodes.length}
          onEngineReady={handleEngineReady}
          onState={setUi}
          onUserSelect={handleCanvasUserSelect}
          onBlankClick={handleBlankClick}
        />
        <div className="stage-atmosphere" aria-hidden="true" />
        <div className="stage-vignette" aria-hidden="true" />

        <MissionHud graph={graph} ui={ui} snapshot={snapshot} />

        <div className="canvas-help" aria-hidden="true">
          <span>拖动空白 平移</span>
          <i />
          <span>滚轮 / 双指 缩放</span>
          <i />
          <span>拖动节点 调整布局</span>
        </div>

        {!panelOpen ? <Legend /> : null}
        <SpatialControls
          onRotate={(yaw, pitch) => engineRef.current?.rotateView(yaw, pitch)}
          follow={ui.camera.follow}
          onToggleFollow={() => engineRef.current?.toggleFollowCamera()}
        />

        <TransportBar
          ui={ui}
          snapshot={snapshot}
          onTogglePause={() => engineRef.current?.togglePaused()}
          onStop={() => engineRef.current?.stopMovement()}
          onStep={handleStep}
          onReplay={handleReplay}
          onSpeed={(speed) => engineRef.current?.setSpeed(speed)}
          onResetLayout={() => engineRef.current?.resetLayout()}
          onFit={() => engineRef.current?.fitView()}
          onToggleFollow={() => engineRef.current?.toggleFollowCamera()}
          onToggleReduced={() => engineRef.current?.setReducedMotion(!ui.reducedMotion)}
          onResumeAuto={handleResumeAuto}
        />

        <SidePanel
          open={panelOpen}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onOpen={openPanel}
          onClose={() => setPanelOpen(false)}
          graph={graph}
          kb={kb}
          ui={ui}
          snapshot={snapshot}
          onSelectNode={selectNodeFromUi}
          onSelectExample={(example) => runSearch(example)}
          onOpenImport={() => setImportOpen(true)}
          onRemoveImported={handleRemoveImported}
        />

        {selectedNode && !panelOpen ? (
          <button type="button" className="selected-peek" onClick={openSelectedDetails}>
            <span className="selected-peek-type">
              {selectedNode.kind === 'topic' ? '主题' : selectedNode.kind === 'document' ? '文档' : '片段'}
            </span>
            <span>{selectedNode.title}</span>
            <span className="selected-peek-arrow">展开</span>
          </button>
        ) : null}

        <AppToast ui={ui} onDismiss={() => engineRef.current?.dismissNotice()} />
      </main>

      <ImportDialog
        open={importOpen}
        kb={kb}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />

      <div className="sr-only" aria-live="polite">
        {ui.mode === 'auto' ? '自动检索模式。' : '手动探索模式。'}
        {selectedNode ? `当前选中 ${selectedNode.title}。` : ''}
        {`知识库共 ${counts.fragments} 个检索片段。`}
      </div>
    </div>
  );
}
