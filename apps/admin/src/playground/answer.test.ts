import { describe, expect, it } from 'vitest';
import { answerMeta, formatDuration } from './answer';

describe('answerMeta', () => {
  const meta = { latencyMs: 2310, model: 'a-model', provider: 'lmstudio', usage: { promptTokens: 1840, completionTokens: 212 } }; // prettier-ignore

  it('gives the latency, the model and the token counts', () => {
    expect(answerMeta(meta)).toBe('2.3 s · a-model · 1,840 + 212 tokens');
  });

  it('names the provider when the model is unknown', () => {
    expect(answerMeta({ ...meta, model: null })).toBe('2.3 s · lmstudio · 1,840 + 212 tokens');
  });

  it('leaves out token counts the provider did not report', () => {
    expect(answerMeta({ ...meta, usage: { promptTokens: null, completionTokens: null } })).toBe(
      '2.3 s · a-model',
    );
    expect(answerMeta({ ...meta, usage: { promptTokens: 1840, completionTokens: null } })).toBe(
      '2.3 s · a-model',
    );
  });

  // An answer that found nothing is not generated, so it reports a latency and nothing else.
  it('leaves out the model when no model was called', () => {
    const notFound = { latencyMs: 120, model: null, provider: null, usage: { promptTokens: null, completionTokens: null } }; // prettier-ignore
    expect(answerMeta(notFound)).toBe('120 ms');
  });
});

describe('formatDuration', () => {
  it('shows milliseconds under a second, then seconds, then minutes', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(840)).toBe('840 ms');
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(2310)).toBe('2.3 s');
    expect(formatDuration(64_200)).toBe('1 min 4 s');
  });
});
