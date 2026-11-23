import { describe, expect, it } from 'vitest';
import { answerMeta, answerParts, formatDuration, passageWhere } from './answer';

describe('answerParts', () => {
  it('leaves text without markers alone', () => {
    expect(answerParts('RAG retrieves passages.', [1, 2])).toEqual([{ text: 'RAG retrieves passages.' }]);
  });

  it('turns a cited [n] into a marker between the text around it', () => {
    expect(answerParts('It retrieves [1] then generates.', [1])).toEqual([
      { text: 'It retrieves ' },
      { rank: 1 },
      { text: ' then generates.' },
    ]);
  });

  it('turns a comma list into one marker per rank', () => {
    expect(answerParts('Both say so [1, 2].', [1, 2])).toEqual([
      { text: 'Both say so ' },
      { rank: 1 },
      { rank: 2 },
      { text: '.' },
    ]);
  });

  it('reads a two-digit rank', () => {
    expect(answerParts('See [12].', [12])).toEqual([{ text: 'See ' }, { rank: 12 }, { text: '.' }]);
  });

  it('leaves a rank with no citation as text', () => {
    expect(answerParts('See [9] and [1].', [1])).toEqual([
      { text: 'See [9] and ' },
      { rank: 1 },
      { text: '.' },
    ]);
    expect(answerParts('Both [1, 9].', [1])).toEqual([{ text: 'Both [1, 9].' }]);
  });

  it('leaves a subscript in code alone, even when its number is a rank', () => {
    expect(answerParts('Read items[1] to get the second element [1].', [1])).toEqual([
      { text: 'Read items[1] to get the second element ' },
      { rank: 1 },
      { text: '.' },
    ]);
  });

  it('keeps markers that follow each other', () => {
    expect(answerParts('Sources [1][2]', [1, 2])).toEqual([{ text: 'Sources ' }, { rank: 1 }, { rank: 2 }]);
  });

  it('has no parts for an empty answer', () => {
    expect(answerParts('', [1])).toEqual([]);
  });
});

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

  // A chat reply carries no provider, and no latency at all when the run never started.
  it('reads a chat reply, which has no provider', () => {
    expect(answerMeta({ latencyMs: 2310, model: 'a-model', usage: meta.usage })).toBe(
      '2.3 s · a-model · 1,840 + 212 tokens',
    );
  });

  it('says nothing at all when the API reported nothing', () => {
    const nothing = { latencyMs: null, model: null, usage: { promptTokens: null, completionTokens: null } };
    expect(answerMeta(nothing)).toBe('');
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

  // Rounding the seconds remainder on its own would write "1 min 60 s" and "60.0 s".
  it('carries the rounded seconds into the next minute', () => {
    expect(formatDuration(119_600)).toBe('2 min 0 s');
    expect(formatDuration(59_950)).toBe('1 min 0 s');
  });
});

describe('passageWhere', () => {
  it('names the document and its page', () => {
    expect(passageWhere({ documentTitle: 'Week 3 slides', page: 12, chunkIndex: 4 })).toBe(
      'Week 3 slides · page 12',
    );
  });

  it('falls back to the passage number when there are no pages', () => {
    expect(passageWhere({ documentTitle: 'notes', page: null, chunkIndex: 4 })).toBe('notes · passage 5');
  });
});
