import type { KnowledgeBase, RawFragment, RawTopic } from '../types';
import { analyze, normalizeText } from './text';

const IMPORT_PALETTE = ['#C7D8C2', '#E8B7A2', '#AEC9DF', '#D8C6A3'];
let importCounter = 0;

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function splitLongParagraph(paragraph: string, maxLength = 560): string[] {
  if (paragraph.length <= maxLength) return [paragraph];
  const sentences = paragraph.split(/(?<=[。！？!?；;])/u).map((entry) => entry.trim()).filter(Boolean);
  if (sentences.length <= 1) {
    const chunks: string[] = [];
    for (let index = 0; index < paragraph.length; index += maxLength) {
      chunks.push(paragraph.slice(index, index + maxLength));
    }
    return chunks;
  }
  const chunks: string[] = [];
  let buffer = '';
  for (const sentence of sentences) {
    if ((buffer + sentence).length > maxLength && buffer) {
      chunks.push(buffer.trim());
      buffer = '';
    }
    buffer += sentence;
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

function deriveKeywords(title: string, text: string): string[] {
  const counts = new Map<string, number>();
  for (const token of analyze(`${title} ${text}`)) {
    if (token.length === 2 && /^[\u3400-\u9fff]+$/.test(token)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] === a[1] ? (a[0] < b[0] ? -1 : 1) : b[1] - a[1]))
    .slice(0, 5)
    .map(([token]) => token);
}

function titleFromText(text: string): string {
  const cleaned = normalizeText(text).replace(/\s+/g, ' ').trim();
  if (!cleaned) return '导入片段';
  return cleaned.length > 24 ? `${cleaned.slice(0, 24)}…` : cleaned;
}

function makeFragments(text: string, topicId: string, stamp: string): RawFragment[] {
  const normalized = cleanText(text);
  const headingMatches = [...normalized.matchAll(/^#{1,6}\s+(.+)$/gm)];
  const units: Array<{ title: string; text: string }> = [];

  if (headingMatches.length >= 2) {
    const headingPositions = headingMatches.map((match) => ({
      index: match.index ?? 0,
      title: match[1].trim(),
    }));
    for (let index = 0; index < headingPositions.length; index += 1) {
      const current = headingPositions[index];
      const next = headingPositions[index + 1];
      const bodyStart = current.index + normalized.slice(current.index).indexOf('\n') + 1;
      const bodyEnd = next ? next.index : normalized.length;
      const body = normalized.slice(bodyStart, bodyEnd).replace(/^#{1,6}\s+/gm, '').trim();
      if (body) units.push({ title: current.title || titleFromText(body), text: body });
    }
  } else {
    const paragraphs = normalized
      .split(/\n{2,}|\n(?=\s*[-*]\s+)/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const source = paragraphs.length ? paragraphs : [normalized];
    for (const paragraph of source) {
      const chunks = splitLongParagraph(paragraph);
      for (const chunk of chunks) units.push({ title: titleFromText(chunk), text: chunk });
    }
  }

  if (!units.length) units.push({ title: titleFromText(normalized), text: normalized });
  const limited = units.slice(0, 8);
  return limited.map((unit, index) => ({
    id: `f-${topicId}-${index + 1}-${stamp}`,
    title: unit.title.length > 52 ? `${unit.title.slice(0, 52)}…` : unit.title,
    text: unit.text,
    keywords: deriveKeywords(unit.title, unit.text),
  }));
}

export interface ImportDraft {
  title: string;
  text: string;
  fileName?: string;
}

export function createImportedTopic(draft: ImportDraft, base: KnowledgeBase): RawTopic {
  const title = draft.title.trim() || titleFromText(draft.text);
  const clean = cleanText(draft.text);
  if (clean.length < 12) throw new Error('正文至少要包含 12 个可见字符。');
  importCounter += 1;
  const stamp = `${Date.now().toString(36)}${importCounter.toString(36)}`;
  const topicId = `t-import-${stamp}`;
  const fragments = makeFragments(clean, topicId, stamp);
  if (!fragments.length) throw new Error('未能从文本中生成有效片段。');
  const color = IMPORT_PALETTE[base.topics.filter((topic) => topic.imported).length % IMPORT_PALETTE.length];
  return {
    id: topicId,
    name: title.length > 26 ? `${title.slice(0, 26)}…` : title,
    subtitle: 'LOCAL SOURCE',
    color,
    summary: `来自本地资料的独立主题，共 ${fragments.length} 个可检索片段。内容只进入当前浏览器内的 BM25 索引。`,
    imported: true,
    docs: [
      {
        id: `d-import-${stamp}`,
        title: draft.fileName ? draft.fileName : title,
        source: draft.fileName ? `本地导入 / ${draft.fileName}` : '本地粘贴 / 未命名来源',
        format: draft.fileName?.toLowerCase().endsWith('.md') ? 'Markdown' : '纯文本',
        summary: `从本地文本导入的文档，已切分为 ${fragments.length} 个片段。导入后形成新的知识主题，并参与下一次检索。`,
        fragments,
      },
    ],
  };
}

export function addImportedTopic(base: KnowledgeBase, topic: RawTopic): KnowledgeBase {
  return {
    ...base,
    version: `${base.version}+${topic.id}`,
    topics: [...base.topics, topic],
  };
}

export function removeImportedTopic(base: KnowledgeBase, topicId: string): KnowledgeBase {
  return {
    ...base,
    version: `${base.version}-${topicId}`,
    topics: base.topics.filter((topic) => topic.id !== topicId),
  };
}

export function baseWithSample(base: KnowledgeBase): boolean {
  return base.topics.some((topic) => !topic.imported);
}

export function countKnowledge(base: KnowledgeBase): {
  topics: number;
  docs: number;
  fragments: number;
  importedTopics: number;
} {
  return base.topics.reduce(
    (acc, topic) => {
      acc.topics += 1;
      acc.docs += topic.docs.length;
      acc.fragments += topic.docs.reduce((sum, doc) => sum + doc.fragments.length, 0);
      if (topic.imported) acc.importedTopics += 1;
      return acc;
    },
    { topics: 0, docs: 0, fragments: 0, importedTopics: 0 },
  );
}
