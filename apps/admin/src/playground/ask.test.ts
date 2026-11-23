import type { Answer } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { askReducer, idleAsk, type AskState } from './ask';

const answer: Answer = {
  id: 'ans_1',
  workspace: 'ouc',
  question: 'What is RAG?',
  text: 'RAG retrieves passages [1].',
  status: 'complete',
  grounded: true,
  citations: [],
  provider: 'lmstudio',
  model: 'a-model',
  usage: { promptTokens: 120, completionTokens: 18 },
  latencyMs: 2310,
  timeToFirstTokenMs: 410,
  error: null,
  feedback: null,
  createdAt: '2026-11-23T10:00:00.000Z',
};

const reduce = (state: AskState, ...events: Parameters<typeof askReducer>[1][]) =>
  events.reduce(askReducer, state);

const streaming = reduce(idleAsk, { type: 'started', question: 'What is RAG?' });

describe('askReducer', () => {
  it('starts streaming and forgets the answer before it', () => {
    const done = reduce(streaming, { type: 'token', text: 'RAG' }, { type: 'done', answer });
    const again = askReducer(done, { type: 'started', question: 'And fine-tuning?' });
    expect(again).toEqual({
      status: 'streaming',
      question: 'And fine-tuning?',
      text: '',
      answer: null,
      error: null,
    });
  });

  it('appends each token to the text so far', () => {
    const state = reduce(streaming, { type: 'token', text: 'RAG ' }, { type: 'token', text: 'retrieves' });
    expect(state.text).toBe('RAG retrieves');
    expect(state.status).toBe('streaming');
  });

  it("keeps the stored record and prefers its text over the stream's", () => {
    const state = reduce(streaming, { type: 'token', text: 'RAG retr' }, { type: 'done', answer });
    expect(state).toEqual({
      status: 'done',
      question: 'What is RAG?',
      text: 'RAG retrieves passages [1].',
      answer,
      error: null,
    });
  });

  it('keeps the streamed text when the record has none', () => {
    const state = reduce(
      streaming,
      { type: 'token', text: 'half' },
      { type: 'done', answer: { ...answer, text: null, status: 'failed' } },
    );
    expect(state.text).toBe('half');
  });

  it('keeps the partial text and the reason when it fails', () => {
    const state = reduce(
      streaming,
      { type: 'token', text: 'half' },
      { type: 'failed', detail: 'Answering failed in Langflow.' },
    );
    expect(state).toEqual({
      status: 'failed',
      question: 'What is RAG?',
      text: 'half',
      answer: null,
      error: 'Answering failed in Langflow.',
    });
  });

  it('keeps the partial text when it is stopped', () => {
    const state = reduce(streaming, { type: 'token', text: 'half' }, { type: 'stopped' });
    expect(state).toEqual({
      status: 'stopped',
      question: 'What is RAG?',
      text: 'half',
      answer: null,
      error: null,
    });
  });

  it('ignores the tail of a run that was already stopped', () => {
    const stopped = reduce(streaming, { type: 'token', text: 'half' }, { type: 'stopped' });
    expect(reduce(stopped, { type: 'token', text: '!' }, { type: 'done', answer })).toEqual(stopped);
  });
});
