import type {
  EdgeKind,
  GraphEdge,
  GraphModel,
  GraphNode,
  KnowledgeBase,
  TopicRegion,
} from '../types';
import { analyze } from '../lib/text';

function cosineSimilarityEdges(graph: GraphModel, maxEdges = 32): GraphEdge[] {
  const fragments = graph.nodes.filter((node) => node.kind === 'fragment');
  const df = new Map<string, number>();
  const tokenized = fragments.map((node) => {
    const tokens = analyze([node.title, node.keywords.join(' '), node.content].join(' '));
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
    return { node, tf };
  });

  const vectors = new Map<string, { values: Map<string, number>; norm: number }>();
  for (const { node, tf } of tokenized) {
    const values = new Map<string, number>();
    let sumSquares = 0;
    for (const [token, count] of tf) {
      const idf = Math.log((fragments.length + 1) / ((df.get(token) ?? 1) + 0.5));
      const weight = (1 + Math.log(count)) * Math.max(0.001, idf);
      values.set(token, weight);
      sumSquares += weight * weight;
    }
    vectors.set(node.id, { values, norm: Math.sqrt(sumSquares) || 1 });
  }

  const candidates: Array<{ a: string; b: string; score: number }> = [];
  for (let i = 0; i < fragments.length; i += 1) {
    const a = fragments[i];
    const va = vectors.get(a.id);
    if (!va) continue;
    for (let j = i + 1; j < fragments.length; j += 1) {
      const b = fragments[j];
      if (a.parentId === b.parentId) continue;
      const vb = vectors.get(b.id);
      if (!vb) continue;
      let dot = 0;
      const [small, large] =
        va.values.size < vb.values.size ? [va.values, vb.values] : [vb.values, va.values];
      for (const [token, weight] of small) {
        const other = large.get(token);
        if (other) dot += weight * other;
      }
      const score = dot / (va.norm * vb.norm);
      if (score >= 0.12) {
        candidates.push({
          a: a.id < b.id ? a.id : b.id,
          b: a.id < b.id ? b.id : a.id,
          score,
        });
      }
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.a !== right.a) return left.a < right.a ? -1 : 1;
    return left.b < right.b ? -1 : 1;
  });

  const selected: GraphEdge[] = [];
  const degree = new Map<string, number>();
  const knownPairs = new Set(
    graph.edges
      .filter((edge) => edge.kind === 'citation')
      .map((edge) => [edge.source, edge.target].sort().join('::')),
  );

  for (const candidate of candidates) {
    if (selected.length >= maxEdges) break;
    if (knownPairs.has(`${candidate.a}::${candidate.b}`)) continue;
    if ((degree.get(candidate.a) ?? 0) >= 2 || (degree.get(candidate.b) ?? 0) >= 2) continue;
    degree.set(candidate.a, (degree.get(candidate.a) ?? 0) + 1);
    degree.set(candidate.b, (degree.get(candidate.b) ?? 0) + 1);
    selected.push({
      id: `e-sim-${candidate.a}-${candidate.b}`,
      source: candidate.a,
      target: candidate.b,
      kind: 'similarity',
      weight: candidate.score,
      curated: false,
    });
  }

  return selected;
}

export function buildGraph(base: KnowledgeBase): GraphModel {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const topics: TopicRegion[] = [];
  const byId = new Map<string, GraphNode>();
  let order = 0;

  for (const topic of base.topics) {
    const topicRegion: TopicRegion = {
      id: topic.id,
      name: topic.name,
      subtitle: topic.subtitle,
      color: topic.color,
      summary: topic.summary,
      nodeIds: [],
      imported: Boolean(topic.imported),
      x: 0,
      y: 0,
    };

    const topicNode: GraphNode = {
      id: topic.id,
      kind: 'topic',
      title: topic.name,
      topicId: topic.id,
      parentId: null,
      childIds: [],
      color: topic.color,
      summary: topic.summary,
      content: topic.summary,
      source: `${topic.docs.length} 篇文档`,
      keywords: [topic.name, topic.subtitle],
      x: 0,
      y: 0,
      order,
      imported: Boolean(topic.imported),
    };
    order += 1;
    nodes.push(topicNode);
    byId.set(topicNode.id, topicNode);
    topicRegion.nodeIds.push(topicNode.id);

    for (const doc of topic.docs) {
      const docNode: GraphNode = {
        id: doc.id,
        kind: 'document',
        title: doc.title,
        topicId: topic.id,
        parentId: topic.id,
        childIds: [],
        color: topic.color,
        summary: doc.summary,
        content: doc.summary,
        source: doc.source,
        keywords: [doc.title, doc.format, topic.name],
        x: 0,
        y: 0,
        order,
        imported: Boolean(topic.imported),
      };
      order += 1;
      nodes.push(docNode);
      byId.set(docNode.id, docNode);
      topicNode.childIds.push(docNode.id);
      topicRegion.nodeIds.push(docNode.id);
      edges.push({
        id: `e-contains-${topic.id}-${doc.id}`,
        source: topic.id,
        target: doc.id,
        kind: 'contains',
        weight: 1,
        curated: true,
      });

      for (const fragment of doc.fragments) {
        const fragmentNode: GraphNode = {
          id: fragment.id,
          kind: 'fragment',
          title: fragment.title,
          topicId: topic.id,
          parentId: doc.id,
          childIds: [],
          color: topic.color,
          summary: fragment.text,
          content: fragment.text,
          source: doc.source,
          keywords: fragment.keywords,
          x: 0,
          y: 0,
          order,
          imported: Boolean(topic.imported),
        };
        order += 1;
        nodes.push(fragmentNode);
        byId.set(fragmentNode.id, fragmentNode);
        docNode.childIds.push(fragmentNode.id);
        topicRegion.nodeIds.push(fragmentNode.id);
        edges.push({
          id: `e-contains-${doc.id}-${fragment.id}`,
          source: doc.id,
          target: fragment.id,
          kind: 'contains',
          weight: 1,
          curated: true,
        });
      }
    }

    topics.push(topicRegion);
  }

  for (const topic of base.topics) {
    for (const doc of topic.docs) {
      for (const fragment of doc.fragments) {
        for (const targetId of fragment.cites ?? []) {
          if (!byId.has(targetId) || targetId === fragment.id) continue;
          const source = fragment.id < targetId ? fragment.id : targetId;
          const target = fragment.id < targetId ? targetId : fragment.id;
          if (edges.some((edge) => edge.id === `e-cite-${source}-${target}`)) continue;
          const explicitSource = byId.get(fragment.id);
          const explicitTarget = byId.get(targetId);
          if (!explicitSource || !explicitTarget) continue;
          edges.push({
            id: `e-cite-${source}-${target}`,
            source: explicitSource.id,
            target: explicitTarget.id,
            kind: 'citation',
            weight: 1,
            curated: true,
          });
        }
      }
    }
  }

  const graph: GraphModel = {
    nodes,
    edges,
    byId,
    topics,
    version: base.version,
    label: base.label,
  };

  graph.edges.push(...cosineSimilarityEdges(graph));

  return graph;
}

export function edgeLabel(kind: EdgeKind): string {
  if (kind === 'contains') return '包含';
  if (kind === 'citation') return '引用';
  return '相似';
}
