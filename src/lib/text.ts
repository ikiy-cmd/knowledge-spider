const HAN_RUN = /[\u3400-\u4dbf\u4e00-\u9fff]+/g;
const LATIN_OR_NUMBER = /[a-z0-9]+(?:[._+-][a-z0-9]+)*/g;

export interface QueryToken {
  token: string;
  weight: number;
  kind: 'han-1' | 'han-2' | 'latin';
}

const QUERY_STOP_CHARS = new Set(
  '的 了 是 在 和 与 及 或 也 就 都 而 被 把 对 为 以 于 其 之 这 那 有 不 么 什 需 要 如 何 怎 样 吗 呢 吧 我 你 他 她 它 们 个 中 上 下 里 外 时 会 能 可 让 给 从 到 将 又 很 更 最'.split(' '),
);

export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A deliberately simple, fully local analyzer.
 * Han runs produce unigrams and bigrams, Latin/number runs stay whole.
 * Search weights bigrams above unigrams; the same analyzer is used for
 * documents and queries so a hit can always be explained.
 */
export function analyze(input: string): string[] {
  const text = normalizeText(input);
  const tokens: string[] = [];
  const matches = text.match(new RegExp(`${HAN_RUN.source}|${LATIN_OR_NUMBER.source}`, 'g')) ?? [];

  for (const run of matches) {
    if (/^[a-z0-9]/.test(run)) {
      tokens.push(run);
      continue;
    }
    const chars = Array.from(run);
    for (const char of chars) tokens.push(char);
    for (let i = 0; i < chars.length - 1; i += 1) {
      tokens.push(chars[i] + chars[i + 1]);
    }
  }

  return tokens;
}

export function queryTokens(input: string): QueryToken[] {
  const raw = analyze(input);
  const best = new Map<string, QueryToken>();

  for (const token of raw) {
    const han = /^[\u3400-\u9fff]+$/.test(token);
    if (han && Array.from(token).every((char) => QUERY_STOP_CHARS.has(char))) continue;
    const kind: QueryToken['kind'] = !han ? 'latin' : token.length === 1 ? 'han-1' : 'han-2';
    const weight = kind === 'han-1' ? 0.18 : kind === 'latin' ? 1.15 : 1;
    const existing = best.get(token);
    if (!existing || weight > existing.weight) {
      best.set(token, { token, weight, kind });
    }
  }

  return [...best.values()];
}

export function describeAnalyzer(): string {
  return '连续汉字取单字与二元字组（二元权重更高），英文与数字保留完整 token；查询侧过滤疑问词与高频功能字，索引侧保留完整 n-gram，查询和片段共用同一分析器。';
}
