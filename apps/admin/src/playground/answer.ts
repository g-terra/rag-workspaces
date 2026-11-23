import type { Answer } from '@rag/shared';

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
