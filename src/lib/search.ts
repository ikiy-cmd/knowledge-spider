import type { KnowledgeBase, SearchHit, SearchSnapshot } from '../types';
import { analyze, describeAnalyzer, queryTokens } from './text';

const BM25_K1 = 1.4;
const BM25_B = 0.72;

interface IndexedFragment {
  fragmentId: string;
  docId: string;
  topicId: string;
  title: string;
  docTitle: string;
  topicName: string;
  source: string;
  text: string;
  keywords: string[];
  order: number;
  tf: Map<string, number>;
  length: number;
}

export interface RetrievalIndex {
  fragments: IndexedFragment[];
  df: Map<string, number>;
  avgLength: number;
  fragmentCount: number;
  method: string;
}

export interface RetrievalResult {
  hits: SearchHit[];
  candidateIds: string[];
  evidenceIds: string[];
  totalMatches: number;
  tokens: string[];
  computeMs: number;
}

function fieldTokens(title: string, keywords: string[], text: string): string[] {
  return [
    ...analyze(title),
    ...analyze(title),
    ...analyze(title),
    ...analyze(keywords.join(' ')),
    ...analyze(keywords.join(' ')),
    ...analyze(text),
  ];
}

export function buildRetrievalIndex(base: KnowledgeBase): RetrievalIndex {
  const fragments: IndexedFragment[] = [];
  const df = new Map<string, number>();
  let order = 0;

  for (const topic of base.topics) {
    for (const doc of topic.docs) {
      for (const fragment of doc.fragments) {
        const tokens = fieldTokens(fragment.title, fragment.keywords, fragment.text);
        const tf = new Map<string, number>();
        for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
        const indexed: IndexedFragment = {
          fragmentId: fragment.id,
          docId: doc.id,
          topicId: topic.id,
          title: fragment.title,
          docTitle: doc.title,
          topicName: topic.name,
          source: doc.source,
          text: fragment.text,
          keywords: fragment.keywords,
          order,
          tf,
          length: tokens.length,
        };
        fragments.push(indexed);
        order += 1;
        for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
      }
    }
  }

  const totalLength = fragments.reduce((sum, fragment) => sum + fragment.length, 0);
  return {
    fragments,
    df,
    avgLength: fragments.length ? totalLength / fragments.length : 0,
    fragmentCount: fragments.length,
    method: `本地 BM25 · k1=${BM25_K1} · b=${BM25_B} · 字段加权（标题×3，关键词×2，正文×1）`,
  };
}

export function retrieve(
  index: RetrievalIndex,
  query: string,
  topK: number,
  candidateVisualLimit = 24,
): RetrievalResult {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const terms = queryTokens(query);
  const safeTopK = Math.max(1, Math.min(24, Math.floor(topK) || 5));
  const scored: Array<{ fragment: IndexedFragment; score: number }> = [];

  if (terms.length && index.fragmentCount > 0) {
    for (const fragment of index.fragments) {
      let score = 0;
      for (const term of terms) {
        const tf = fragment.tf.get(term.token) ?? 0;
        if (!tf) continue;
        const docFreq = index.df.get(term.token) ?? 0;
        const idf = Math.log(1 + (index.fragmentCount - docFreq + 0.5) / (docFreq + 0.5));
        const lengthNorm = 1 - BM25_B + BM25_B * (fragment.length / index.avgLength);
        const normalizedTf = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lengthNorm);
        score += term.weight * idf * normalizedTf;
      }
      if (score > 0) scored.push({ fragment, score });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.fragment.order !== b.fragment.order) return a.fragment.order - b.fragment.order;
    return a.fragment.fragmentId < b.fragment.fragmentId ? -1 : 1;
  });

  const hits = scored.slice(0, safeTopK).map<SearchHit>(({ fragment, score }, position) => ({
    rank: position + 1,
    fragmentId: fragment.fragmentId,
    docId: fragment.docId,
    topicId: fragment.topicId,
    title: fragment.title,
    docTitle: fragment.docTitle,
    topicName: fragment.topicName,
    source: fragment.source,
    text: fragment.text,
    keywords: fragment.keywords,
    score,
  }));

  const finished = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    hits,
    candidateIds: scored.slice(0, candidateVisualLimit).map((entry) => entry.fragment.fragmentId),
    evidenceIds: hits.map((hit) => hit.fragmentId),
    totalMatches: scored.length,
    tokens: terms.map((term) => term.token),
    computeMs: Math.max(0, finished - started),
  };
}

export function createSearchSnapshot(
  index: RetrievalIndex,
  query: string,
  topK: number,
  id: number,
): SearchSnapshot {
  const result = retrieve(index, query, topK);
  return {
    id,
    query,
    topK,
    hits: result.hits,
    candidateIds: result.candidateIds,
    evidenceIds: result.evidenceIds,
    totalMatches: result.totalMatches,
    tokens: result.tokens,
    computeMs: result.computeMs,
    method: `${index.method}；${describeAnalyzer()}`,
  };
}
