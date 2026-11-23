import type { Conversation, Message } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { conversationName, messageBody } from './thread';

const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'cnv_1',
  workspace: 'ouc',
  title: 'Retrieval basics',
  createdAt: '2026-11-23T09:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
  ...over,
});

const message = (over: Partial<Message> = {}): Message => ({
  id: 'msg_1',
  conversationId: 'cnv_1',
  role: 'assistant',
  content: 'Retrieval finds the passages first.',
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

describe('conversationName', () => {
  it('uses the title the API gave it', () => {
    expect(conversationName(conversation())).toBe('Retrieval basics');
  });

  // The API takes the title from the first message, but a conversation created with none and never
  // sent to still shows in the list.
  it('names an untitled conversation rather than showing a blank row', () => {
    expect(conversationName(conversation({ title: null }))).toBe('Untitled conversation');
    expect(conversationName(conversation({ title: '  ' }))).toBe('Untitled conversation');
  });
});

describe('messageBody', () => {
  it('shows what the model said', () => {
    expect(messageBody(message())).toEqual({
      text: 'Retrieval finds the passages first.',
      error: null,
      failed: false,
    });
  });

  it('explains a reply that found nothing relevant enough, which has no text', () => {
    const body = messageBody(message({ grounded: false, content: null }));
    expect(body.failed).toBe(false);
    expect(body.error).toBeNull();
    expect(body.text).toMatch(/close enough/);
  });

  it('gives the reason a reply failed', () => {
    expect(
      messageBody(message({ status: 'failed', content: null, error: 'The provider timed out.' })),
    ).toEqual({ text: '', error: 'The provider timed out.', failed: true });
  });

  it('says a reply failed even when the API gave no reason', () => {
    expect(messageBody(message({ status: 'failed', content: null, error: null }))).toEqual({
      text: '',
      error: 'The reply failed.',
      failed: true,
    });
  });

  // A reply can fail part-way through generating, and then it has both text and a reason.
  it('keeps both the words a failed reply had written and the reason it failed', () => {
    const partial = message({ status: 'failed', content: 'Retrieval finds', error: 'Dropped.' });
    expect(messageBody(partial)).toEqual({
      text: 'Retrieval finds',
      error: 'Dropped.',
      failed: true,
    });
  });

  it('falls back to a default failure reason when partial content has no error string', () => {
    const partial = message({ status: 'failed', content: 'Retrieval finds', error: null });
    expect(messageBody(partial)).toEqual({
      text: 'Retrieval finds',
      error: 'The reply failed.',
      failed: true,
    });
  });
});
