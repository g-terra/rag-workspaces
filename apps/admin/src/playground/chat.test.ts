import type { Message } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { chatReducer, idleChat, lastTurn, type ChatState } from './chat';

const reply = (over: Partial<Message> = {}): Message => ({
  id: 'msg_1',
  conversationId: 'cnv_1',
  role: 'assistant',
  content: 'Retrieval finds the passages [1].',
  status: 'complete',
  grounded: true,
  citations: [],
  model: 'a-model',
  style: null,
  usage: { promptTokens: 1840, completionTokens: 212 },
  latencyMs: 2340,
  timeToFirstTokenMs: 310,
  error: null,
  createdAt: '2026-11-23T10:00:00.000Z',
  ...over,
});

/** Runs the events in order from an empty chat. */
const run = (...events: Parameters<typeof chatReducer>[1][]): ChatState =>
  events.reduce(chatReducer, idleChat);

describe('chatReducer', () => {
  it('opens a turn for the message that was sent', () => {
    const state = run({ type: 'sent', question: 'what is rag?' });
    expect(state.turns).toEqual([
      { question: 'what is rag?', text: '', reply: null, error: null, status: 'streaming' },
    ]);
  });

  it('appends the tokens of the turn being answered', () => {
    const state = run(
      { type: 'sent', question: 'what is rag?' },
      { type: 'token', text: 'Retrieval ' },
      { type: 'token', text: 'finds' },
    );
    expect(lastTurn(state)?.text).toBe('Retrieval finds');
  });

  it('takes the stored reply as the final text, so a dropped token is not left out', () => {
    const state = run(
      { type: 'sent', question: 'what is rag?' },
      { type: 'token', text: 'Retrieval ' },
      { type: 'done', reply: reply() },
    );
    expect(lastTurn(state)).toMatchObject({
      status: 'done',
      text: 'Retrieval finds the passages [1].',
      reply: { id: 'msg_1' },
    });
  });

  it('keeps the tokens when the stored reply has no content', () => {
    const state = run(
      { type: 'sent', question: 'what is rag?' },
      { type: 'token', text: 'Retrieval' },
      { type: 'done', reply: reply({ content: null, status: 'failed' }) },
    );
    expect(lastTurn(state)?.text).toBe('Retrieval');
  });

  it('marks the turn failed with the reason, keeping what had arrived', () => {
    const state = run(
      { type: 'sent', question: 'what is rag?' },
      { type: 'token', text: 'Retr' },
      { type: 'failed', error: { status: 503, detail: 'Reindexing.' } },
    );
    expect(lastTurn(state)).toMatchObject({
      status: 'failed',
      text: 'Retr',
      error: { status: 503, detail: 'Reindexing.' },
    });
  });

  it('ignores events that arrive after the turn stopped', () => {
    const state = run(
      { type: 'sent', question: 'what is rag?' },
      { type: 'token', text: 'Retr' },
      { type: 'stopped' },
      { type: 'token', text: 'ieval' },
      { type: 'done', reply: reply() },
    );
    expect(lastTurn(state)).toMatchObject({ status: 'stopped', text: 'Retr', reply: null });
  });

  it('keeps the earlier turns as they were and answers only the newest', () => {
    const state = run(
      { type: 'sent', question: 'first' },
      { type: 'done', reply: reply({ id: 'msg_1', content: 'one' }) },
      { type: 'sent', question: 'second' },
      { type: 'token', text: 'tw' },
    );
    expect(state.turns.map((t) => [t.question, t.text, t.status])).toEqual([
      ['first', 'one', 'done'],
      ['second', 'tw', 'streaming'],
    ]);
  });

  // Sending aborts the request in flight, so the turn it was answering must not be left running.
  it('stops a turn that was still streaming when the next message is sent', () => {
    const state = run(
      { type: 'sent', question: 'first' },
      { type: 'token', text: 'on' },
      { type: 'sent', question: 'second' },
    );
    expect(state.turns.map((t) => t.status)).toEqual(['stopped', 'streaming']);
    expect(state.turns[0]!.text).toBe('on');
  });

  it('starts from nothing when the chat is cleared', () => {
    const state = run({ type: 'sent', question: 'first' }, { type: 'cleared' });
    expect(state).toEqual(idleChat);
  });
});

describe('lastTurn', () => {
  it('has no turn to answer in an empty chat', () => {
    expect(lastTurn(idleChat)).toBeNull();
  });
});
