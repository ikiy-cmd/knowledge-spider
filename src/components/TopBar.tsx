import { ArrowRight, Books, CursorClick, MagnifyingGlass, Sparkle } from '@phosphor-icons/react';
import { SpiderMark } from './SpiderMark';

interface TopBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  topK: number;
  onTopKChange: (value: number) => void;
  queryError: string | null;
  mode: 'manual' | 'auto';
  onModeChange: (mode: 'manual' | 'auto') => void;
  onOpenImport: () => void;
  stats: { nodes: number; topics: number };
  autoPaused: boolean;
}

export function TopBar({
  query,
  onQueryChange,
  onSubmit,
  topK,
  onTopKChange,
  queryError,
  mode,
  onModeChange,
  onOpenImport,
  stats,
  autoPaused,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand-block" aria-label="蛛知 Knowledge Spider">
        <span className="brand-mark">
          <SpiderMark size={30} />
        </span>
        <div className="brand-copy">
          <div className="brand-line">
            <span className="brand-name">蛛知</span>
            <span className="brand-divider" aria-hidden="true" />
            <span className="brand-en">KNOWLEDGE SPIDER</span>
          </div>
          <div className="brand-sub">
            <span>知识检索台</span>
            <span className="brand-sub-dot" aria-hidden="true" />
            <span>{stats.nodes} 个节点</span>
            <span className="brand-sub-dot" aria-hidden="true" />
            <span>{stats.topics} 个主题</span>
          </div>
        </div>
      </div>

      <form
        className={`query-form${queryError ? ' has-error' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="query-field">
          <MagnifyingGlass className="query-icon" size={17} weight="regular" aria-hidden="true" />
          <label className="sr-only" htmlFor="query-input">
            检索知识库
          </label>
          <input
            id="query-input"
            data-testid="query-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="问这张知识网，例如：BM25 为什么需要稳定排序？"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(queryError)}
            aria-describedby={queryError ? 'query-error' : undefined}
          />
          <span className="enter-hint" aria-hidden="true">
            Enter
          </span>
        </div>
        <div className="query-actions">
          <label className="topk-control">
            <span>TopK</span>
            <select
              value={topK}
              onChange={(event) => onTopKChange(Number(event.target.value))}
              aria-label="返回结果数量 TopK"
              data-testid="topk-select"
            >
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={8}>8</option>
              <option value={12}>12</option>
            </select>
          </label>
          <button type="submit" className="search-submit" data-testid="search-submit">
            <span>开始检索</span>
            <ArrowRight size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>
        {queryError ? (
          <div className="query-error" id="query-error" role="alert">
            {queryError}
          </div>
        ) : null}
      </form>

      <div className="topbar-tail">
        <div className="mode-switch" role="group" aria-label="探索模式">
          <button
            type="button"
            className={`mode-button${mode === 'manual' ? ' is-active' : ''}`}
            aria-pressed={mode === 'manual'}
            onClick={() => onModeChange('manual')}
            data-testid="mode-manual"
          >
            <CursorClick size={13} weight="regular" aria-hidden="true" />
            <span>手动探索</span>
          </button>
          <button
            type="button"
            className={`mode-button${mode === 'auto' ? ' is-active' : ''}`}
            aria-pressed={mode === 'auto'}
            onClick={() => onModeChange('auto')}
            data-testid="mode-auto"
          >
            <Sparkle size={13} weight="regular" aria-hidden="true" />
            <span>自动检索</span>
            {autoPaused ? <i className="mode-pause-dot" aria-label="自动演示已暂停" /> : null}
          </button>
        </div>
        <button
          type="button"
          className="library-button"
          onClick={onOpenImport}
          title="添加本地资料"
          aria-label="添加本地资料"
          data-testid="open-import"
        >
          <Books size={16} weight="regular" aria-hidden="true" />
          <span>资料</span>
        </button>
      </div>
    </header>
  );
}
