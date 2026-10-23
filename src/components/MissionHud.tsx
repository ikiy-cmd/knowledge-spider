import {
  BookOpenText,
  Check,
  Compass,
  CursorClick,
  Pause,
  Stop,
  WarningCircle,
} from '@phosphor-icons/react';
import type { EngineUiState, GraphModel, SearchSnapshot } from '../types';

interface MissionHudProps {
  graph: GraphModel;
  ui: EngineUiState;
  snapshot: SearchSnapshot | null;
}

function getStatus(ui: EngineUiState): {
  label: string;
  hint: string;
  tone: string;
  Icon: typeof Compass;
} {
  if (ui.phase === 'dragging') {
    return {
      label: '正在调整位置',
      hint: '松开后从当前状态重新规划，不会跳回旧位置。',
      tone: 'drag',
      Icon: CursorClick,
    };
  }
  if (ui.paused && (ui.phase === 'traveling' || ui.phase === 'settling' || ui.phase === 'reading')) {
    return {
      label: '动画已暂停',
      hint: '当前位置、朝向和落脚点已保留。',
      tone: 'hold',
      Icon: Pause,
    };
  }
  if (ui.demo.status === 'paused' && ui.targetId && ui.targetId !== ui.selectedId) {
    return {
      label: '自动演示已暂停',
      hint: '点击底部「继续自动演示」，蜘蛛会从当前位置重新规划。',
      tone: 'hold',
      Icon: Pause,
    };
  }
  switch (ui.phase) {
    case 'traveling':
      return {
        label: '前往中',
        hint: '身体沿时间轴推进，触手交替寻找新的支撑点。',
        tone: 'move',
        Icon: Compass,
      };
    case 'settling':
      return {
        label: '正在落脚',
        hint: '目标已接触，其余触手依次落向附近的有效节点。',
        tone: 'move',
        Icon: Compass,
      };
    case 'reading':
      return {
        label: '已接触 · 读取中',
        hint: '仅当前读取节点出现知识回流，光点沿触手向身体移动。',
        tone: 'read',
        Icon: BookOpenText,
      };
    case 'arrived':
      return {
        label: '已到达',
        hint: '知识详情已展开，可继续点击其他节点探索。',
        tone: 'arrived',
        Icon: Check,
      };
    case 'stopped':
      return {
        label: '移动已停止',
        hint: '蜘蛛已在最近的有效位置落足，检索结果保持不变。',
        tone: 'halt',
        Icon: Stop,
      };
    case 'blocked':
      return {
        label: '目标不可达',
        hint: '蜘蛛不会跳到隐藏或已删除的目标位置，请重新选择节点。',
        tone: 'warn',
        Icon: WarningCircle,
      };
    default:
      return {
        label: '待命',
        hint: '点击任意知识光点，让蜘蛛沿网靠近并读取它。',
        tone: 'idle',
        Icon: Compass,
      };
  }
}

export function MissionHud({ graph, ui, snapshot }: MissionHudProps) {
  const target = ui.targetId ? graph.byId.get(ui.targetId) : null;
  const selected = ui.selectedId ? graph.byId.get(ui.selectedId) : null;
  const node = selected ?? target;
  const status = getStatus(ui);
  const Icon = status.Icon;
  const evidenceRank = node ? snapshot?.hits.find((hit) => hit.fragmentId === node.id)?.rank : undefined;
  const topic = node ? graph.topics.find((entry) => entry.id === node.topicId) : undefined;
  const counts = graph.nodes.reduce(
    (acc, entry) => {
      if (entry.kind === 'document') acc.docs += 1;
      if (entry.kind === 'fragment') acc.fragments += 1;
      return acc;
    },
    { docs: 0, fragments: 0 },
  );
  const autoPaused =
    ui.demo.status === 'paused' || (ui.paused && ui.demo.status === 'running' && ui.mode === 'auto');

  return (
    <section className="mission-hud" aria-label="当前观测状态">
      <div className="hud-topline">
        <span className="hud-live">
          <i className={`hud-live-dot${status.tone === 'move' || status.tone === 'read' ? ' is-live' : ''}`} />
          本地知识网络
        </span>
        <span className="hud-index">{ui.mode === 'auto' ? 'AUTO RETRIEVAL' : 'MANUAL EXPLORATION'}</span>
      </div>

      <div className="hud-body" aria-live="polite">
        <div className="hud-kicker">
          {node ? (
            <>
              <span className="hud-node-type">
                {node.kind === 'topic' ? '主题' : node.kind === 'document' ? '文档' : '知识片段'}
              </span>
              {topic ? (
                <span className="hud-topic">
                  <i style={{ background: topic.color }} />
                  {topic.name}
                </span>
              ) : null}
              {evidenceRank ? <span className="hud-evidence">证据 #{String(evidenceRank).padStart(2, '0')}</span> : null}
            </>
          ) : (
            <span className="hud-node-type">{ui.mode === 'auto' ? '自动检索' : '探索模式'}</span>
          )}
        </div>
        <h1 className="hud-title" data-testid="hud-title">
          {node ? node.title : '让知识，在连接中浮现'}
        </h1>
        <div className={`hud-status tone-${status.tone}`} data-testid="hud-status">
          <Icon size={13} weight="regular" aria-hidden="true" />
          <span>{status.label}</span>
          <span className="hud-status-separator" aria-hidden="true" />
          <span className="hud-mode">{ui.mode === 'auto' ? '自动检索' : '手动探索'}</span>
          {autoPaused ? <span className="hud-auto-pause">回放暂停</span> : null}
        </div>
        <p className="hud-hint">{status.hint}</p>
      </div>

      <div className="hud-foot">
        <span>{graph.topics.length} 主题</span>
        <span>{counts.docs} 文档</span>
        <span>{counts.fragments} 片段</span>
        <span className="hud-foot-local">
          <i />
          仅本地索引
        </span>
      </div>
    </section>
  );
}
