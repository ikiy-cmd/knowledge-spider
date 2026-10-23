export function Legend() {
  return (
    <aside className="legend" aria-label="知识网络图例">
      <div className="legend-head">
        <span>图例</span>
        <span className="legend-key">KEY</span>
      </div>
      <div className="legend-row">
        <span className="legend-item">
          <i className="legend-topic-dot" />
          主题
        </span>
        <span className="legend-item">
          <i className="legend-doc-mark" />
          文档
        </span>
        <span className="legend-item">
          <i className="legend-fragment-dot" />
          片段
        </span>
      </div>
      <div className="legend-row">
        <span className="legend-item">
          <i className="legend-line contains" />
          包含
        </span>
        <span className="legend-item">
          <i className="legend-line citation" />
          引用
        </span>
        <span className="legend-item">
          <i className="legend-line similarity" />
          相似
        </span>
      </div>
      <div className="legend-row">
        <span className="legend-item">
          <i className="legend-ring candidate" />
          候选
        </span>
        <span className="legend-item">
          <i className="legend-rank">01</i>
          证据
        </span>
        <span className="legend-item">
          <i className="legend-ring support" />
          支撑
        </span>
      </div>
      <p className="legend-note">路线仅演示读取顺序，不代表检索算法的遍历路径。</p>
    </aside>
  );
}
