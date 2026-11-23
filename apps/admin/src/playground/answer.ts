import type { Answer, Passage } from '@rag/shared';

/** Why a reply has no text: nothing in the workspace was relevant enough, so no model was called. */
export const NOT_GROUNDED = 'Nothing in this workspace was close enough to that, so no reply was generated.';

/** Shown under a reply that cites none of the passages the model read (`grounded: false` with citations). */
export const UNCITED =
  'This reply cites none of the passages below, so the material probably does not answer it.';

/**
 * Nothing in the workspace was relevant enough, so no model ran and there is no reply to show. A reply
 * that is `grounded: false` but has citations is different: the model read those passages, cited none,
 * and its own words (usually "the material does not cover it") are shown.
 */
export function foundNothing(reply: { grounded: boolean | null; citations: unknown[] }): boolean {
  return reply.grounded === false && reply.citations.length === 0;
}

/** A piece of an answer: text to show, or the `[n]` marker of a citation to open. */
export type AnswerPart = { text: string } | { rank: number };

// `[1]`, `[12]` or `[1, 2]`: how the system prompt asks the model to cite its passages. Some models
// (gpt-oss) write their own house style instead, fullwidth `【1】` or `【1†L3-L5】`; the locator is dropped.
const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]|【(\d+(?:\s*,\s*\d+)*)(?:†[^】]*)?】/g;
// A citation follows a space, punctuation or another citation. Anything else to its left makes it part
// of that word, such as the subscript in `items[1]`, which is code the model wrote, not a citation.
const ATTACHED = /[\p{L}\p{N}_$\]]/u;

/**
 * Splits an answer into text and the citation markers in it. A marker only becomes one when every rank
 * it names has a citation (`ranks`) and nothing is attached to its left; anything else — a reference to
 * a passage the answer does not carry, or an index like `items[1]` in a code snippet — stays the text
 * the model wrote.
 */
export function answerParts(text: string, ranks: number[]): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let at = 0;
  const keep = (upTo: number) => {
    if (upTo > at) parts.push({ text: text.slice(at, upTo) });
  };
  for (const match of text.matchAll(MARKER)) {
    const cited = (match[1] ?? match[2])!.split(',').map((n) => Number(n.trim()));
    if (!cited.every((rank) => ranks.includes(rank))) continue;
    // A marker directly after another is the second half of a list like `[1][2]`, not an index.
    if (match.index !== at && ATTACHED.test(text[match.index - 1] ?? '')) continue;
    keep(match.index);
    for (const rank of cited) parts.push({ rank });
    at = match.index + match[0].length;
  }
  keep(text.length);
  return parts;
}

/** A chat reply has no provider to fall back on, and no latency at all when the run never started. */
type Meta = Pick<Answer, 'model' | 'usage'> & {
  latencyMs: number | null;
  provider?: string | null;
};

/** "2.3 s · a-model · 1,840 + 212 tokens", without the parts the API did not report. */
export function answerMeta({ latencyMs, model, provider = null, usage }: Meta): string {
  const parts = [latencyMs === null ? null : formatDuration(latencyMs), model ?? provider];
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

/** A time in a recording as people read it: 12:34, or 1:02:03 past an hour. */
export function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const [h, m] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60)];
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Where a passage sits: "Week 3 slides · page 12", "Lecture 3 · at 12:34" for a recording, or its
 * position when the document has neither.
 */
export function passageWhere({
  documentTitle,
  page,
  startSeconds,
  chunkIndex,
}: Pick<Passage, 'documentTitle' | 'page' | 'startSeconds' | 'chunkIndex'>): string {
  const where =
    page !== null
      ? `page ${page}`
      : startSeconds !== null
        ? `at ${clock(startSeconds)}`
        : `passage ${chunkIndex + 1}`;
  return `${documentTitle} · ${where}`;
}
