import { describe, expect, it } from 'vitest';
import { createSseParser, reconnectDelay } from './sse';

describe('createSseParser', () => {
  it('reads an event name and its data', () => {
    const parse = createSseParser();
    expect(parse('event: document\ndata: {"id":"d1"}\n\n')).toEqual([
      { event: 'document', data: '{"id":"d1"}' },
    ]);
  });

  it('defaults the event name to "message"', () => {
    expect(createSseParser()('data: hi\n\n')).toEqual([{ event: 'message', data: 'hi' }]);
  });

  it('reads several frames from one chunk', () => {
    const parse = createSseParser();
    expect(parse('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n')).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('keeps a frame split across chunks until it is complete', () => {
    const parse = createSseParser();
    expect(parse('event: snap')).toEqual([]);
    expect(parse('shot\ndata: {"data"')).toEqual([]);
    expect(parse(':[]}\n')).toEqual([]);
    expect(parse('\n')).toEqual([{ event: 'snapshot', data: '{"data":[]}' }]);
  });

  it('handles the blank line split between chunks', () => {
    const parse = createSseParser();
    expect(parse('data: x\n')).toEqual([]);
    expect(parse('\ndata: y\n\n')).toEqual([
      { event: 'message', data: 'x' },
      { event: 'message', data: 'y' },
    ]);
  });

  it('ignores comments, such as keep-alives', () => {
    const parse = createSseParser();
    expect(parse(': keep-alive\n\n')).toEqual([]);
    expect(parse('event: removed\n: note\ndata: {"id":"d1"}\n\n')).toEqual([
      { event: 'removed', data: '{"id":"d1"}' },
    ]);
  });

  it('joins several data lines with newlines', () => {
    expect(createSseParser()('data: a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
  });

  it('accepts CRLF and CR line endings', () => {
    const parse = createSseParser();
    expect(parse('event: a\r\ndata: 1\r\n\r\nevent: b\rdata: 2\r\r')).toEqual([{ event: 'a', data: '1' }]);
    // The last CR could be half of a CRLF, so it ends the frame once the next character arrives.
    expect(parse(':')).toEqual([{ event: 'b', data: '2' }]);
  });

  it('keeps a CRLF split between chunks as one line ending', () => {
    const parse = createSseParser();
    expect(parse('data: 1\r')).toEqual([]);
    expect(parse('\n\r\n')).toEqual([{ event: 'message', data: '1' }]);
  });

  it('takes "field:value" without a space, and drops only one leading space', () => {
    expect(createSseParser()('event:a\ndata:  two\n\n')).toEqual([{ event: 'a', data: ' two' }]);
  });

  it('dispatches nothing for a frame without data', () => {
    expect(createSseParser()('event: lonely\n\n')).toEqual([]);
  });

  it('ignores other fields', () => {
    expect(createSseParser()('id: 7\nretry: 100\ndata: x\n\n')).toEqual([{ event: 'message', data: 'x' }]);
  });
});

describe('reconnectDelay', () => {
  it('doubles from one second and stops at thirty', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(reconnectDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
});
