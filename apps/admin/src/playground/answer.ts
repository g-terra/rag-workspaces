import type { Answer, Passage } from '@rag/shared';

/** A piece of an answer: text to show, or the `[n]` marker of a citation to open. */
export type AnswerPart = { text: string } | { rank: number };

// `[1]`, `[12]` or `[1, 2]`: how the system prompt asks the model to cite its passages.
const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Splits an answer into text and the citation markers in it. A marker only becomes one when every rank
 * it names has a citation (`ranks`); anything else, such as a reference to a passage that is not in the
 * answer's citations, stays the text the model wrote.
 */
export function answerParts(text: string, ranks: number[]): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let at = 0;
  const keep = (upTo: number) => {
    if (upTo > at) parts.push({ text: text.slice(at, upTo) });
  };
  for (const match of text.matchAll(MARKER)) {
    const cited = match[1]!.split(',').map((n) => Number(n.trim()));
    if (!cited.every((rank) => ranks.includes(rank))) continue;
    keep(match.index);
    for (const rank of cited) parts.push({ rank });
    at = match.index + match[0].length;
  }
  keep(text.length);
  return parts;
}

type Meta = Pick<Answer, 'latencyMs' | 'model' | 'provider' | 'usage'>;

/** "2.3 s · a-model · 1,840 + 212 tokens", without the parts the API did not report. */
export function answerMeta({ latencyMs, model, provider, usage }: Meta): string {
  const parts = [formatDuration(latencyMs), model ?? provider];
  if (usage.promptTokens !== null && usage.completionTokens !== null) {
    parts.push(
      `${usage.promptTokens.toLocaleString('en')} + ${usage.completionTokens.toLocaleString('en')} tokens`,
    );
  }
  return parts.filter(Boolean).join(' · ');
}

/** "840 ms" below a second, then "2.3 s", then "1 min 4 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  // Round to the unit shown before splitting: rounding the remainder alone writes "1 min 60 s".
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Where a passage sits: "Week 3 slides · page 12", or its position when the document has no pages. */
export function passageWhere({
  documentTitle,
  page,
  chunkIndex,
}: Pick<Passage, 'documentTitle' | 'page' | 'chunkIndex'>): string {
  return `${documentTitle} · ${page === null ? `passage ${chunkIndex + 1}` : `page ${page}`}`;
}
