import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpenText,
  CaretRight,
  Check,
  Compass,
  Graph,
  Info,
  LinkSimple,
  MagnifyingGlass,
  UploadSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type { EngineUiState, GraphModel, GraphNode, KnowledgeBase, SearchSnapshot } from '../types';
import { exampleQueries } from '../data/sampleKnowledge';
import { countKnowledge } from '../lib/importKnowledge';

export type PanelTab = 'detail' | 'results';

interface SidePanelProps {
  open: boolean;
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onOpen: () => void;
  onClose: () => void;
  graph: GraphModel;
  kb: KnowledgeBase;
  ui: EngineUiState;
  snapshot: SearchSnapshot | null;
  onSelectNode: (nodeId: string) => void;
  onSelectExample: (query: string) => void;
  onOpenImport: () => void;
  onRemoveImported: (topicId: string) => void;
}

function getRelated(graph: GraphModel, nodeId: string): Array<{
  node: GraphNode;
  label: string;
  detail: string;
  kind: string;
}> {
  const related = graph.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => {
      const otherId = edge.source === nodeId ? edge.target : edge.source;
      const other = graph.byId.get(otherId);
      if (!other) return null;
      let label = '关联';
      let detail = '';
      if (edge.kind === 'contains') {
        label = edge.source === nodeId ? '包含' : '属于';
        detail = edge.source === nodeId ? other.title : other.title;
      } else if (edge.kind === 'citation') {
        label = edge.source === nodeId ? '引用' : '被引用';
        detail = other.source;
      } else {
        label = '文本相似';
        detail = `余弦 ${edge.weight.toFixed(3)}`;
      }
      return { node: other, label, detail, kind: edge.kind };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        const order: Record<string, number> = { contains: 0, citation: 1, similarity: 2 };
        return (order[a.kind] ?? 3) - (order[b.kind] ?? 3);
      }
      return a.node.order - b.node.order;
    });
  return related.slice(0, 8);
}

function EmptyPanel({
  graph,
  kb,
  hasSnapshot,
  onSelectNode,
  onOpenImport,
}: {
  graph: GraphModel;
  kb: KnowledgeBase;
  hasSnapshot: boolean;
  onSelectNode: (nodeId: string) => void;
  onOpenImport: () => void;
}) {
  const counts = countKnowledge(kb);
  return (
    <div className="panel-empty">
      <div className="empty-glyph" aria-hidden="true">
        <span />
        <span />
        <span />
        <i />
      </div>
      <p className="eyebrow">尚未观测</p>
      <h2>{hasSnapshot ? '查看本次检索结果' : '从一颗知识光点开始'}</h2>
      <p className="empty-copy">
        点击知识网络中的节点，蜘蛛会爬向它，用一条前侧触手接触并读取内容。手动阅读不会改变检索排名。
      </p>
      <div className="empty-topic-list">
        {graph.topics.map((topic) => {
          const docs = graph.nodes.filter(
            (node) => node.topicId === topic.id && node.kind === 'document',
          ).length;
          const fragments = graph.nodes.filter(
            (node) => node.topicId === topic.id && node.kind === 'fragment',
          ).length;
          return (
            <button
              key={topic.id}
              type="button"
              className="empty-topic-button"
              onClick={() => onSelectNode(topic.id)}
            >
              <span className="topic-dot" style={{ background: topic.color }} />
              <span className="topic-name">{topic.name}</span>
              <span className="topic-count">
                {docs} 篇 / {fragments} 段
              </span>
              <CaretRight size={12} weight="regular" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="empty-meta">
        <span>本地索引</span>
        <span>{counts.docs} 文档</span>
        <span>{counts.fragments} 片段</span>
        <span>未接入远程模型</span>
      </div>
      <button type="button" className="text-action" onClick={onOpenImport}>
        <UploadSimple size={14} weight="regular" aria-hidden="true" />
        导入本地 TXT / Markdown
      </button>
    </div>
  );
}

function NoResults({
  snapshot,
  onSelectExample,
}: {
  snapshot: SearchSnapshot;
  onSelectExample: (query: string) => void;
}) {
  const suggestions = exampleQueries.filter((query) => query !== snapshot.query).slice(0, 3);
  return (
    <div className="empty-results">
      <div className="empty-search-mark" aria-hidden="true">
        <MagnifyingGlass size={22} weight="light" />
      </div>
      <p className="eyebrow">0 条证据</p>
      <h2>没有找到匹配证据</h2>
      <p className="empty-copy">
        本地 BM25 已实际计算，但没有片段命中查询词项。蜘蛛留在原地，不会生成虚构节点或补足结果。
      </p>
      <div className="empty-token-block">
        <span className="mini-label">查询词项</span>
        <div className="token-cloud">
          {snapshot.tokens.length ? (
            snapshot.tokens.map((token) => (
              <span className="token" key={token}>
                {token}
              </span>
            ))
          ) : (
            <span className="token muted">无可分析词项</span>
          )}
        </div>
      </div>
      <div className="suggestion-list">
        <span className="mini-label">换一种问法</span>
        {suggestions.map((query) => (
          <button
            type="button"
            key={query}
            className="suggestion-button"
            onClick={() => onSelectExample(query)}
          >
            <span>{query}</span>
            <ArrowRight size={12} weight="regular" aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="method-footnote">未接入语义向量或生成式回答。当前仅使用本地 BM25 检索。</p>
    </div>
  );
}

function ResultsContent({
  snapshot,
  ui,
  onSelectNode,
  onSelectExample,
}: {
  snapshot: SearchSnapshot | null;
  ui: EngineUiState;
  onSelectNode: (nodeId: string) => void;
  onSelectExample: (query: string) => void;
}) {
  if (!snapshot) {
    return (
      <div className="empty-results">
        <div className="empty-search-mark" aria-hidden="true">
          <MagnifyingGlass size={22} weight="light" />
        </div>
        <p className="eyebrow">本地检索</p>
        <h2>问这张网一个问题</h2>
        <p className="empty-copy">
          查询会经过中文分词、真实 BM25 召回、稳定排序，再由蜘蛛按名次逐一读取证据。动画不参与检索。
        </p>
        <div className="suggestion-list">
          <span className="mini-label">试试这些问题</span>
          {exampleQueries.slice(0, 3).map((query) => (
            <button
              type="button"
              key={query}
              className="suggestion-button"
              onClick={() => onSelectExample(query)}
            >
              <span>{query}</span>
              <ArrowRight size={12} weight="regular" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="method-card">
          <p className="method-card-title">
            <Info size={13} weight="regular" aria-hidden="true" />
            当前能力边界
          </p>
          <p>真实实现：中文 n-gram、BM25、稳定排序、查询快照、动画回放。</p>
          <p>未接入：语义向量、模型回答、跨文档自动摘要。界面不会把未实现的能力伪装成已具备。</p>
        </div>
      </div>
    );
  }

  if (!snapshot.hits.length) {
    return <NoResults snapshot={snapshot} onSelectExample={onSelectExample} />;
  }

  const selectedRank = ui.selectedId
    ? snapshot.hits.find((hit) => hit.fragmentId === ui.selectedId)?.rank
    : undefined;
  const visited = new Set(ui.demo.visited);
  const current = ui.demo.currentId;
  const tokens = snapshot.tokens;
  const maxTokens = 12;

  return (
    <div className="results-content">
      <div className="results-heading">
        <p className="eyebrow">查询快照 #{String(snapshot.id).padStart(3, '0')}</p>
        <h2>“{snapshot.query}”</h2>
        <div className="result-stats">
          <span>
            命中 <strong>{snapshot.totalMatches}</strong>
          </span>
          <span>
            返回 <strong>{snapshot.hits.length}</strong>
          </span>
          <span>
            TopK <strong>{snapshot.topK}</strong>
          </span>
          <span className="mono">{snapshot.computeMs.toFixed(1)} ms</span>
        </div>
      </div>

      <div className="pipeline" aria-label="检索与演示流程">
        <div className="pipeline-step is-done">
          <span className="pipeline-index">01</span>
          <span className="pipeline-name">分词</span>
          <span className="pipeline-value">{tokens.length} 词项</span>
        </div>
        <div className="pipeline-step is-done">
          <span className="pipeline-index">02</span>
          <span className="pipeline-name">召回</span>
          <span className="pipeline-value">{snapshot.totalMatches} 命中</span>
        </div>
        <div className="pipeline-step is-done">
          <span className="pipeline-index">03</span>
          <span className="pipeline-name">排序</span>
          <span className="pipeline-value">Top {snapshot.hits.length}</span>
        </div>
        <div className={`pipeline-step${ui.demo.status === 'complete' ? ' is-done' : ' is-live'}`}>
          <span className="pipeline-index">04</span>
          <span className="pipeline-name">演示</span>
          <span className="pipeline-value">
            {ui.demo.index}/{snapshot.hits.length}
          </span>
        </div>
      </div>

      <div className="token-row">
        <span className="mini-label">查询词项</span>
        <div className="token-cloud compact">
          {tokens.slice(0, maxTokens).map((token) => (
            <span className="token" key={token}>
              {token}
            </span>
          ))}
          {tokens.length > maxTokens ? <span className="token muted">+{tokens.length - maxTokens}</span> : null}
        </div>
      </div>

      <div className="results-list" aria-label="检索结果列表">
        {snapshot.hits.map((hit) => {
          const isVisited = visited.has(hit.fragmentId);
          const isCurrent =
            current === hit.fragmentId && !isVisited && ui.demo.status !== 'complete';
          const isSelected = selectedRank === hit.rank;
          const isReading = isCurrent && ui.phase === 'reading';
          const isMoving = isCurrent && (ui.phase === 'traveling' || ui.phase === 'settling');
          const isPaused = isCurrent && (ui.paused || ui.demo.status === 'paused');
          const stateClass = isReading
            ? ' reading'
            : isVisited
              ? ' visited'
              : isMoving
                ? ' traveling'
                : isPaused
                  ? ' paused'
                  : '';
          const stateLabel = isReading
            ? '读取中'
            : isVisited
              ? '已读'
              : isPaused
                ? '已暂停'
                : isMoving
                  ? '前往中'
                  : '待读取';
          return (
            <button
              type="button"
              key={hit.fragmentId}
              className={`result-row${isCurrent ? ' is-current' : ''}${isSelected ? ' is-selected' : ''}`}
              onClick={() => onSelectNode(hit.fragmentId)}
              data-testid={`result-row-${hit.rank}`}
            >
              <span className="result-rank">{String(hit.rank).padStart(2, '0')}</span>
              <span className="result-main">
                <span className="result-title">{hit.title}</span>
                <span className="result-source">
                  {hit.docTitle}
                  <i aria-hidden="true">/</i>
                  {hit.topicName}
                </span>
                <span className="result-snippet">{hit.text}</span>
              </span>
              <span className="result-side">
                <span className="result-score">{hit.score.toFixed(3)}</span>
                <span className={`result-state${stateClass}`}>
                  {isReading ? <BookOpenText size={11} weight="regular" /> : null}
                  {isMoving ? <Compass size={11} weight="regular" /> : null}
                  {isVisited && !isCurrent ? <Check size={11} weight="bold" /> : null}
                  <span>{stateLabel}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="results-notes">
        <p>
          分数为 BM25 原始分，仅用于本次查询的内部排序，不代表事实可信度。候选圈在图中最多展示前 24
          条匹配，最终证据为本次 TopK。
        </p>
        <p>
          点击任意结果行会暂停自动演示并进入手动探索。暂停、调速与重播只控制动画，不重复检索。
        </p>
        <p>蜘蛛的巡读顺序按空间就近编排，结果排名保持 BM25 原始顺序，两者相互独立。</p>
      </div>

      <details className="method-details">
        <summary>检索与分词说明</summary>
        <p>{snapshot.method}</p>
        <p>
          中文连续文本生成单字与二元字组，长词组权重更高；相同的全角转半角与英文小写规则同时用于索引和查询。
          查询侧会移除“为什么、如何、需要”等疑问词与高频功能字，索引侧保留完整 n-gram。
          同分时按片段固定序号、再按 id 稳定排序。
        </p>
        <p>未接入语义向量或生成式回答。无匹配时返回空结果，不补足、不伪造分数。</p>
      </details>
    </div>
  );
}

function DetailContent({
  graph,
  ui,
  snapshot,
  onSelectNode,
  onRemoveImported,
  selectedNode,
}: {
  graph: GraphModel;
  ui: EngineUiState;
  snapshot: SearchSnapshot | null;
  onSelectNode: (nodeId: string) => void;
  onRemoveImported: (topicId: string) => void;
  selectedNode: GraphNode;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const topic = graph.topics.find((entry) => entry.id === selectedNode.topicId);
  const evidence = snapshot?.hits.find((hit) => hit.fragmentId === selectedNode.id);
  const isVisited = ui.manualVisited.includes(selectedNode.id);
  const wasAutoRead = ui.demo.visited.includes(selectedNode.id);
  const contactReady =
    (ui.targetId === selectedNode.id && (ui.phase === 'reading' || ui.phase === 'arrived')) ||
    isVisited ||
    wasAutoRead;
  const readingNow = ui.targetId === selectedNode.id && ui.phase === 'reading';
  const related = useMemo(() => getRelated(graph, selectedNode.id), [graph, selectedNode.id]);
  const children = selectedNode.childIds
    .map((id) => graph.byId.get(id))
    .filter((node): node is GraphNode => Boolean(node));
  const parent = selectedNode.parentId ? graph.byId.get(selectedNode.parentId) : null;
  const imported = Boolean(selectedNode.imported);
  const relationshipTitle =
    selectedNode.kind === 'topic' ? '包含的文档' : selectedNode.kind === 'document' ? '包含的片段' : '一跳关系';

  useEffect(() => {
    setConfirmRemove(false);
  }, [selectedNode.id]);

  return (
    <article className="detail-content">
      <div className="detail-heading">
        <div className="detail-kicker">
          <span className="detail-type">
            {selectedNode.kind === 'topic' ? '主题节点' : selectedNode.kind === 'document' ? '文档节点' : '知识片段'}
          </span>
          {topic ? (
            <span className="detail-topic">
              <i style={{ background: topic.color }} />
              {topic.name}
            </span>
          ) : null}
          {evidence ? <span className="evidence-chip">检索证据 #{String(evidence.rank).padStart(2, '0')}</span> : null}
          {!evidence && isVisited ? <span className="manual-chip">手动查看</span> : null}
          {!evidence && wasAutoRead ? <span className="evidence-chip muted">本轮已读</span> : null}
        </div>
        <h2>{selectedNode.title}</h2>
        <p className="detail-source">{selectedNode.source}</p>
      </div>

      <div className={`readout${readingNow ? ' is-reading' : contactReady ? ' is-ready' : ' is-waiting'}`}>
        <span className="readout-icon">
          {readingNow ? (
            <BookOpenText size={14} weight="regular" />
          ) : contactReady ? (
            <Check size={14} weight="bold" />
          ) : (
            <span className="readout-pulse" />
          )}
        </span>
        <span>
          {readingNow
            ? '蜘蛛已接触节点，知识光点正沿触手回流'
            : contactReady
              ? '本次观测内容已由蜘蛛读取'
              : ui.phase === 'traveling' || ui.phase === 'settling'
                ? '蜘蛛正在前往，接触后展开原文'
                : '尚未读取，可让蜘蛛前往该节点'}
        </span>
      </div>

      {evidence ? (
        <div className="score-strip">
          <div>
            <span className="mini-label">BM25 原始分</span>
            <strong>{evidence.score.toFixed(4)}</strong>
          </div>
          <div>
            <span className="mini-label">稳定名次</span>
            <strong>#{String(evidence.rank).padStart(2, '0')}</strong>
          </div>
          <p>仅用于本次查询排序，不是可信度百分比。</p>
        </div>
      ) : null}

      <section className="detail-section">
        <div className="section-heading">
          <span>原文与摘要</span>
          <span className="section-rule" />
        </div>
        {contactReady ? (
          <div className="node-copy">
            <p>{selectedNode.content}</p>
          </div>
        ) : (
          <div className="locked-copy">
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line medium" />
            <div className="locked-label">
              <span>等待触手接触</span>
              <button type="button" onClick={() => onSelectNode(selectedNode.id)}>
                让蜘蛛前往
                <ArrowRight size={12} weight="regular" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </section>

      {selectedNode.keywords.length ? (
        <div className="keyword-row">
          {selectedNode.keywords.slice(0, 6).map((keyword) => (
            <span className="keyword" key={keyword}>
              {keyword}
            </span>
          ))}
        </div>
      ) : null}

      {parent ? (
        <section className="detail-section">
          <div className="section-heading">
            <span>上级节点</span>
            <span className="section-rule" />
          </div>
          <button type="button" className="relation-row is-parent" onClick={() => onSelectNode(parent.id)}>
            <span className="relation-marker" />
            <span className="relation-main">
              <strong>{parent.title}</strong>
              <small>{parent.kind === 'topic' ? '主题' : '文档'}</small>
            </span>
            <CaretRight size={12} weight="regular" aria-hidden="true" />
          </button>
        </section>
      ) : null}

      {children.length ? (
        <section className="detail-section">
          <div className="section-heading">
            <span>{relationshipTitle}</span>
            <span className="section-rule" />
          </div>
          <div className="children-list">
            {children.slice(0, 8).map((child) => (
              <button
                type="button"
                className="child-row"
                key={child.id}
                onClick={() => onSelectNode(child.id)}
              >
                <span className="child-type">{child.kind === 'document' ? 'DOC' : 'SEG'}</span>
                <span className="child-title">{child.title}</span>
                <CaretRight size={11} weight="regular" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="detail-section">
        <div className="section-heading">
          <span>一跳关系</span>
          <span className="section-rule" />
          <span className="section-meta">{related.length} 条</span>
        </div>
        {related.length ? (
          <div className="relation-list">
            {related.map((entry) => {
              const Icon =
                entry.kind === 'citation' ? LinkSimple : entry.kind === 'similarity' ? Graph : CaretRight;
              return (
                <button
                  type="button"
                  className={`relation-row relation-${entry.kind}`}
                  key={`${entry.kind}-${entry.node.id}`}
                  onClick={() => onSelectNode(entry.node.id)}
                >
                  <span className="relation-icon">
                    <Icon size={12} weight="regular" aria-hidden="true" />
                  </span>
                  <span className="relation-main">
                    <strong>{entry.node.title}</strong>
                    <small>
                      {entry.label}
                      {entry.detail ? ` · ${entry.detail}` : ''}
                    </small>
                  </span>
                  <CaretRight size={11} weight="regular" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ) : (
          <p className="quiet-copy">该节点当前没有一跳关系。</p>
        )}
      </section>

      <div className="detail-note">
        <Info size={13} weight="regular" aria-hidden="true" />
        <p>
          手动访问只记录“查看过”，不会把节点标记为算法命中，也不会改变检索分数与名次。拖动布局同样不会改变结果。
        </p>
      </div>

      {imported && topic ? (
        <section className="danger-zone">
          <div>
            <span className="mini-label">导入资料</span>
            <p>移除后，相关主题、片段、关系与检索索引都会同步删除。</p>
          </div>
          <button
            type="button"
            className={`danger-button${confirmRemove ? ' is-confirming' : ''}`}
            onClick={() => {
              if (!confirmRemove) {
                setConfirmRemove(true);
                return;
              }
              setConfirmRemove(false);
              onRemoveImported(topic.id);
            }}
          >
            {confirmRemove ? (
              <>
                <WarningCircle size={14} weight="regular" aria-hidden="true" />
                再次点击确认移除
              </>
            ) : (
              '移除该导入主题'
            )}
          </button>
        </section>
      ) : null}
    </article>
  );
}

export function SidePanel({
  open,
  activeTab,
  onTabChange,
  onOpen,
  onClose,
  graph,
  kb,
  ui,
  snapshot,
  onSelectNode,
  onSelectExample,
  onOpenImport,
  onRemoveImported,
}: SidePanelProps) {
  const selectedNode = ui.selectedId ? graph.byId.get(ui.selectedId) ?? null : null;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab, ui.selectedId, snapshot?.id, open]);

  const tab = activeTab;
  const resultCount = snapshot?.hits.length ?? 0;

  return (
    <>
      {!open ? (
        <button
          type="button"
          className="panel-rail"
          onClick={onOpen}
          aria-label="展开侧面板"
          title="展开知识详情与检索结果"
          data-testid="open-panel"
        >
          <BookOpenText size={15} weight="regular" aria-hidden="true" />
          <span>观测</span>
          {resultCount ? <i className="panel-rail-count">{resultCount}</i> : null}
        </button>
      ) : null}

      <aside
        className={`side-panel${open ? ' is-open' : ''}`}
        aria-label="知识与检索面板"
        aria-hidden={!open}
        data-testid="side-panel"
      >
        <div className="panel-topbar">
          <div className="panel-tabs" role="tablist" aria-label="面板内容">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'detail'}
              className={`panel-tab${tab === 'detail' ? ' is-active' : ''}`}
              onClick={() => onTabChange('detail')}
              data-testid="tab-detail"
            >
              知识详情
              {selectedNode ? <i className="tab-dot" /> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'results'}
              className={`panel-tab${tab === 'results' ? ' is-active' : ''}`}
              onClick={() => onTabChange('results')}
              data-testid="tab-results"
            >
              检索结果
              {resultCount ? <span className="tab-count">{resultCount}</span> : null}
            </button>
          </div>
          <button
            type="button"
            className="icon-button panel-close"
            onClick={onClose}
            aria-label="收起侧面板"
            title="收起面板"
            data-testid="close-panel"
          >
            <X size={15} weight="regular" />
          </button>
        </div>

        <div className="panel-scroll" ref={scrollRef}>
          {tab === 'detail' ? (
            selectedNode ? (
              <DetailContent
                graph={graph}
                ui={ui}
                snapshot={snapshot}
                onSelectNode={onSelectNode}
                onRemoveImported={onRemoveImported}
                selectedNode={selectedNode}
              />
            ) : (
              <EmptyPanel
                graph={graph}
                kb={kb}
                hasSnapshot={Boolean(snapshot)}
                onSelectNode={onSelectNode}
                onOpenImport={onOpenImport}
              />
            )
          ) : (
            <ResultsContent
              snapshot={snapshot}
              ui={ui}
              onSelectNode={onSelectNode}
              onSelectExample={onSelectExample}
            />
          )}
        </div>
      </aside>
    </>
  );
}
