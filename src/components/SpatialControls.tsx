import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair, GlobeHemisphereWest } from '@phosphor-icons/react';

export function SpatialControls({ onRotate, follow, onToggleFollow }: {
  onRotate: (yaw: number, pitch: number) => void;
  follow: boolean;
  onToggleFollow: () => void;
}) {
  return (
    <aside className="spatial-controls" aria-label="立体视角控制">
      <div className="spatial-control-title"><GlobeHemisphereWest size={15} /><span>立体视图</span><small>3D</small></div>
      <div className="orbit-buttons">
        <button type="button" onClick={() => onRotate(-0.22, 0)} aria-label="向左旋转知识球" title="向左旋转" data-testid="orbit-left"><ArrowLeft size={15} /></button>
        <button type="button" onClick={() => onRotate(0, -0.18)} aria-label="向上旋转知识球" title="向上旋转" data-testid="orbit-up"><ArrowUp size={15} /></button>
        <button type="button" onClick={() => onRotate(0, 0.18)} aria-label="向下旋转知识球" title="向下旋转" data-testid="orbit-down"><ArrowDown size={15} /></button>
        <button type="button" onClick={() => onRotate(0.22, 0)} aria-label="向右旋转知识球" title="向右旋转" data-testid="orbit-right"><ArrowRight size={15} /></button>
      </div>
      <button type="button" className={`spatial-follow${follow ? ' is-active' : ''}`} onClick={onToggleFollow} aria-pressed={follow} aria-label="跟随蜘蛛移动" data-testid="spatial-follow">
        <Crosshair size={15} /><span>跟随蜘蛛</span><i aria-hidden="true" /><small>{follow ? '开启' : '暂停'}</small>
      </button>
      <p><kbd>Shift</kbd> + 拖动，自由旋转</p>
    </aside>
  );
}
