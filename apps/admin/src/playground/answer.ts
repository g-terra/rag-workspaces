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
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}
