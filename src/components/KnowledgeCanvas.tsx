import { useEffect, useRef } from 'react';
import type { EngineUiState, GraphModel } from '../types';
import { Experience } from '../engine/Experience';

interface KnowledgeCanvasProps {
  graph: GraphModel;
  graphRevision: number;
  nodeCount: number;
  onEngineReady: (engine: Experience) => void;
  onState: (state: EngineUiState) => void;
  onUserSelect: (nodeId: string) => void;
  onBlankClick: () => void;
}

export function KnowledgeCanvas({
  graph,
  graphRevision,
  nodeCount,
  onEngineReady,
  onState,
  onUserSelect,
  onBlankClick,
}: KnowledgeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Experience | null>(null);
  const initialGraphRef = useRef(graph);
  const callbacksRef = useRef({ onEngineReady, onState, onUserSelect, onBlankClick });
  const firstRevisionRef = useRef(graphRevision);

  callbacksRef.current = { onEngineReady, onState, onUserSelect, onBlankClick };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const experience = new Experience(canvas, initialGraphRef.current, {
      onState: (state) => callbacksRef.current.onState(state),
      onUserSelect: (nodeId) => callbacksRef.current.onUserSelect(nodeId),
      onBlankClick: () => callbacksRef.current.onBlankClick(),
    });
    engineRef.current = experience;
    if (import.meta.env.DEV) {
      (window as unknown as { __ZHUZHI_DEV__?: unknown }).__ZHUZHI_DEV__ = experience;
    }
    callbacksRef.current.onEngineReady(experience);
    return () => {
      if (import.meta.env.DEV) {
        delete (window as unknown as { __ZHUZHI_DEV__?: unknown }).__ZHUZHI_DEV__;
      }
      engineRef.current = null;
      experience.destroy();
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (graphRevision === firstRevisionRef.current) return;
    engine.updateGraph(graph, { fitAfter: true });
  }, [graph, graphRevision]);

  return (
    <canvas
      ref={canvasRef}
      className="knowledge-canvas"
      aria-label={`蛛知立体知识网络，共 ${nodeCount} 个知识节点。可点击节点让蜘蛛读取，拖动空白平移画布，按住 Shift 拖动旋转知识球，滚轮缩放。检索结果也提供可点击列表。`}
      data-testid="knowledge-canvas"
      role="img"
    />
  );
}
