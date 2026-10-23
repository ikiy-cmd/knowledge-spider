import {
  ArrowCounterClockwise,
  CornersOut,
  Crosshair,
  EyeSlash,
  Pause,
  Play,
  SkipForward,
  Sparkle,
  Stop,
} from '@phosphor-icons/react';
import type { EngineUiState, SearchSnapshot } from '../types';

interface TransportBarProps {
  ui: EngineUiState;
  snapshot: SearchSnapshot | null;
  onTogglePause: () => void;
  onStop: () => void;
  onStep: () => void;
  onReplay: () => void;
  onSpeed: (speed: number) => void;
  onResetLayout: () => void;
  onFit: () => void;
  onToggleFollow: () => void;
  onToggleReduced: () => void;
  onResumeAuto: () => void;
}

const SPEEDS = [0.5, 1, 2];

export function TransportBar({
  ui,
  snapshot,
  onTogglePause,
  onStop,
  onStep,
  onReplay,
  onSpeed,
  onResetLayout,
  onFit,
  onToggleFollow,
  onToggleReduced,
  onResumeAuto,
}: TransportBarProps) {
  const hasSearch = Boolean(snapshot && snapshot.hits.length);
  const canStop =
    ui.phase === 'traveling' ||
    ui.phase === 'settling' ||
    ui.phase === 'reading' ||
    ui.phase === 'dragging';
  const showResume = Boolean(hasSearch && ui.demo.status === 'paused');

  return (
    <div className="transport-wrap">
      <nav className="transport" aria-label="知识网络控制栏">
        <div className="transport-group playback-group">
          <button
            type="button"
            className={`transport-button${ui.paused ? ' is-emphasized' : ''}`}
            onClick={onTogglePause}
            title={ui.paused ? '继续动画时间轴' : '暂停动画时间轴'}
            data-testid="toggle-pause"
          >
            {ui.paused ? <Play size={15} weight="fill" /> : <Pause size={15} weight="regular" />}
            <span>{ui.paused ? '继续' : '暂停'}</span>
          </button>
          <button
            type="button"
            className="transport-button"
            onClick={onStop}
            disabled={!canStop}
            title="停止当前移动，在最近有效位置平滑落足"
            data-testid="stop-motion"
          >
            <Stop size={15} weight="regular" />
            <span>停止</span>
          </button>
          <button
            type="button"
            className="transport-button"
            onClick={onStep}
            disabled={!hasSearch}
            title="自动演示单步：读取一条证据后暂停"
            data-testid="step-demo"
          >
            <SkipForward size={15} weight="regular" />
            <span>单步</span>
          </button>
          <button
            type="button"
            className="transport-button"
            onClick={onReplay}
            disabled={!hasSearch}
            title="使用当前检索快照重播，不重新检索"
            data-testid="replay-demo"
          >
            <ArrowCounterClockwise size={15} weight="regular" />
            <span>重播</span>
          </button>
        </div>

        {showResume ? (
          <div className="transport-group resume-group">
            <button
              type="button"
              className="transport-button resume-button"
              onClick={onResumeAuto}
              title="从蜘蛛当前位置重新规划，继续剩余自动演示"
              data-testid="resume-auto"
            >
              <Sparkle size={14} weight="fill" aria-hidden="true" />
              <span>继续自动演示</span>
            </button>
          </div>
        ) : null}

        <div className="transport-group speed-group" role="group" aria-label="动画速度">
          {SPEEDS.map((speed) => (
            <button
              type="button"
              key={speed}
              className={`speed-button${ui.speed === speed ? ' is-active' : ''}`}
              aria-pressed={ui.speed === speed}
              onClick={() => onSpeed(speed)}
              title={`动画速度 ${speed} 倍`}
              data-testid={`speed-${speed}`}
            >
              {speed}×
            </button>
          ))}
        </div>

        <div className="transport-group view-group">
          <button
            type="button"
            className="transport-button view-button"
            onClick={onResetLayout}
            title="恢复初始节点布局，不改变检索结果"
            data-testid="reset-layout"
          >
            <ArrowCounterClockwise size={14} weight="regular" />
            <span>恢复布局</span>
          </button>
          <button
            type="button"
            className="transport-button view-button"
            onClick={onFit}
            title="缩放并平移到完整知识网络"
            data-testid="fit-view"
          >
            <CornersOut size={14} weight="regular" />
            <span>适应画布</span>
          </button>
          <button
            type="button"
            className={`transport-button view-button toggle-button${
              ui.camera.follow ? ' is-active' : ''
            }`}
            aria-pressed={ui.camera.follow}
            onClick={onToggleFollow}
            title="平滑跟随蜘蛛移动，并保留前进方向视野；手动平移或旋转会暂停跟随"
            data-testid="toggle-follow"
          >
            <Crosshair size={14} weight="regular" />
            <span>移动跟随</span>
          </button>
          <button
            type="button"
            className={`transport-button view-button toggle-button${
              ui.reducedMotion ? ' is-active' : ''
            }`}
            aria-pressed={ui.reducedMotion}
            onClick={onToggleReduced}
            title="减少装饰光效、持续脉冲与自动镜头运动"
            data-testid="toggle-reduced"
          >
            <EyeSlash size={14} weight="regular" />
            <span>减弱动画</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
