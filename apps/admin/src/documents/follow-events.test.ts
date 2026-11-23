import type { Document } from '@rag/shared';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentEvent } from './events';
import { followDocumentEvents } from './follow-events';

function doc(over: Partial<Document> = {}): Document {
  return {
    id: 'doc_1',
    workspace: 'ouc',
    folderId: null,
    title: 'notes',
    fileName: 'notes.md',
    type: 'md',
    sizeBytes: 2048,
    sha256: 'ab'.repeat(32),
    status: 'queued',
    attempts: 0,
    error: null,
    passageCount: null,
    tags: [],
    siteId: null,
    sourceUrl: null,
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    ...over,
  };
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A stream response the test writes to and ends; it errors like `fetch` does when the request is aborted. */
function openStream(signal: AbortSignal) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    write: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

type Stream = ReturnType<typeof openStream>;

/** Drives `followDocumentEvents` with a fake `fetch` whose answers the test chooses, one per request. */
function harness(answers: ((signal: AbortSignal) => Response | Stream)[] = []) {
  const streams: Stream[] = [];
  const urls: string[] = [];
  const tokens: (string | null)[] = [];
  const delays: number[] = [];
  const events: DocumentEvent[] = [];
  const stops: string[] = [];
  const auth = {
    getToken: vi.fn(() => Promise.resolve('t1')),
    renewToken: vi.fn(() => Promise.resolve('t2')),
    endSession: vi.fn(),
  };
  let waiting: (() => void) | null = null;
  const fetch = vi.fn((url: string, init: RequestInit) => {
    urls.push(url);
    tokens.push(new Headers(init.headers).get('authorization'));
    const answer = answers.shift();
    const signal = init.signal!;
    const out = answer ? answer(signal) : openStream(signal);
    if (out instanceof Response) return Promise.resolve(out);
    streams.push(out);
    return Promise.resolve(out.response);
  });
  const follow = (slug: string, signal: AbortSignal) =>
    followDocumentEvents({
      slug,
      auth,
      signal,
      fetch: fetch as unknown as typeof globalThis.fetch,
      onEvent: (e) => events.push(e),
      onStop: (reason) => stops.push(reason),
      wait: (ms) => {
        delays.push(ms);
        return new Promise<void>((resolve) => (waiting = resolve));
      },
    });
  /** Ends the current backoff wait, so the next attempt starts. */
  const resume = () => {
    const w = waiting;
    waiting = null;
    w?.();
  };
  return { streams, urls, tokens, delays, events, stops, auth, fetch, follow, resume };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('followDocumentEvents', () => {
  it('emits the snapshot, document and removed events with the bearer token', async () => {
    const h = harness();
    const abort = new AbortController();
    void h.follow('ouc', abort.signal);
    await flush();
    expect(h.urls).toEqual(['/api/v1/workspaces/ouc/documents/events']);
    expect(h.tokens).toEqual(['Bearer t1']);

    h.streams[0]!.write(frame('snapshot', { data: [doc()] }));
    h.streams[0]!.write(frame('document', doc({ status: 'ready' })) + frame('removed', { id: 'doc_2' }));
    await flush();
    expect(h.events).toEqual([
      { type: 'snapshot', documents: [doc()] },
      { type: 'document', document: doc({ status: 'ready' }) },
      { type: 'removed', id: 'doc_2' },
    ]);
    abort.abort();
  });

  it("skips bad frames and other workspaces' documents", async () => {
    const h = harness();
    const abort = new AbortController();
    void h.follow('ouc', abort.signal);
    await flush();
    h.streams[0]!.write(frame('document', { id: 'doc_1', status: 'ready' }));
    h.streams[0]!.write('event: document\ndata: {oops\n\n');
    h.streams[0]!.write(frame('snapshot', { items: [] }));
    h.streams[0]!.write(frame('document', doc({ workspace: 'other' })));
    h.streams[0]!.write(
      frame('snapshot', { data: [doc({ id: 'a', workspace: 'other' }), doc({ id: 'b' })] }),
    );
    await flush();
    expect(h.events).toEqual([{ type: 'snapshot', documents: [doc({ id: 'b' })] }]);
    abort.abort();
  });

  it('reconnects with backoff when the stream ends, and a snapshot resets it', async () => {
    const h = harness([() => new Response('', { status: 502 })]);
    const abort = new AbortController();
    void h.follow('ouc', abort.signal);
    await flush();
    expect(h.delays).toEqual([1000]);

    h.resume();
    await flush();
    h.streams[0]!.end();
    await flush();
    expect(h.delays).toEqual([1000, 2000]);

    h.resume();
    await flush();
    h.streams[1]!.write(frame('snapshot', { data: [] }));
    h.streams[1]!.end();
    await flush();
    expect(h.delays).toEqual([1000, 2000, 1000]);
    expect(h.fetch).toHaveBeenCalledTimes(3);
    abort.abort();
  });

  it('aborts the request and stops when the signal aborts', async () => {
    const h = harness();
    const abort = new AbortController();
    const done = h.follow('ouc', abort.signal);
    await flush();
    abort.abort();
    await done;
    expect(h.fetch.mock.calls[0]![1].signal!.aborted).toBe(true);
    expect(h.delays).toEqual([]);
    expect(h.fetch).toHaveBeenCalledOnce();
  });

  it('emits nothing more once aborted, even for frames already received', async () => {
    const h = harness();
    const abort = new AbortController();
    void h.follow('ouc', abort.signal);
    await flush();
    h.streams[0]!.write(frame('document', doc()));
    abort.abort();
    await flush();
    expect(h.events).toEqual([]);
  });

  it('follows a new slug at its own URL after the old one is aborted', async () => {
    const h = harness();
    const first = new AbortController();
    void h.follow('ouc', first.signal);
    await flush();
    first.abort();
    const second = new AbortController();
    void h.follow('personal', second.signal);
    await flush();
    expect(h.urls).toEqual([
      '/api/v1/workspaces/ouc/documents/events',
      '/api/v1/workspaces/personal/documents/events',
    ]);
    h.streams[1]!.write(frame('document', doc({ workspace: 'personal' })));
    await flush();
    expect(h.events).toEqual([{ type: 'document', document: doc({ workspace: 'personal' }) }]);
    second.abort();
  });

  it('renews the token once on a 401, then reads the stream', async () => {
    const h = harness([() => new Response('', { status: 401 })]);
    const abort = new AbortController();
    void h.follow('ouc', abort.signal);
    await flush();
    expect(h.tokens).toEqual(['Bearer t1', 'Bearer t2']);
    h.streams[0]!.write(frame('snapshot', { data: [] }));
    await flush();
    expect(h.events).toHaveLength(1);
    expect(h.auth.endSession).not.toHaveBeenCalled();
    abort.abort();
  });

  it('ends the session when the renewed token is refused too, and stops', async () => {
    const unauthorized = () => new Response('', { status: 401 });
    const h = harness([unauthorized, unauthorized]);
    await h.follow('ouc', new AbortController().signal);
    expect(h.auth.endSession).toHaveBeenCalledOnce();
    expect(h.delays).toEqual([]);
  });

  it('stops retrying on 403 or 404 and says why', async () => {
    for (const status of [403, 404]) {
      const h = harness([
        () =>
          new Response(JSON.stringify({ detail: `No access (${status})` }), {
            status,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ]);
      await h.follow('ouc', new AbortController().signal);
      expect(h.stops).toEqual([`No access (${status})`]);
      expect(h.delays).toEqual([]);
    }
  });
});
