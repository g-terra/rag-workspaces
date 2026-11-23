import { Answer } from '@rag/shared';
import { describe, expect, it, vi } from 'vitest';
import { streamGeneration } from './stream';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

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

/** A stream response the test writes to and ends; it errors the way `fetch` does when aborted. */
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

function harness(answers: Response[] = [], controller = new AbortController()) {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const tokens: (string | null)[] = [];
  const tokenTexts: string[] = [];
  const auth = {
    getToken: vi.fn(() => Promise.resolve<string | null>('t1')),
    renewToken: vi.fn(() => Promise.resolve<string | null>('t2')),
    endSession: vi.fn(),
  };
  const fetch = vi.fn((url: string, init: RequestInit) => {
    urls.push(url);
    inits.push(init);
    tokens.push(new Headers(init.headers).get('authorization'));
    const next = answers.shift();
    if (!next) throw new Error('no answer prepared');
    return Promise.resolve(next);
  }) as unknown as typeof globalThis.fetch;
  const run = () =>
    streamGeneration<Answer>({
      path: '/v1/workspaces/ouc/answers',
      body: { question: 'What is RAG?' },
      result: Answer,
      auth,
      signal: controller.signal,
      onToken: (text) => tokenTexts.push(text),
      fetch,
    });
  return { run, auth, controller, urls, inits, tokens, tokenTexts };
}

describe('streamGeneration', () => {
  it('posts the body to /api with Accept: text/event-stream and the bearer token', async () => {
    const stream = openStream(new AbortController().signal);
    const h = harness([stream.response]);
    const running = h.run();
    stream.write(frame('done', answer));
    stream.end();
    await running;

    expect(h.urls).toEqual(['/api/v1/workspaces/ouc/answers']);
    const init = h.inits[0]!;
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('accept')).toBe('text/event-stream');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(init.body).toBe('{"question":"What is RAG?"}');
    expect(h.tokens).toEqual(['Bearer t1']);
  });

  it('reports each token as it arrives, then the done record', async () => {
    const stream = openStream(new AbortController().signal);
    const h = harness([stream.response]);
    const running = h.run();
    stream.write(frame('token', { text: 'RAG ' }));
    stream.write(frame('token', { text: 'retrieves' }));
    stream.write(frame('citations', { citations: [] }));
    stream.write(frame('done', answer));
    stream.end();

    expect(await running).toEqual({ kind: 'done', result: answer });
    expect(h.tokenTexts).toEqual(['RAG ', 'retrieves']);
  });

  it('turns an error event into a failure with its status and detail', async () => {
    const stream = openStream(new AbortController().signal);
    const h = harness([stream.response]);
    const running = h.run();
    stream.write(frame('token', { text: 'RAG ' }));
    stream.write(
      frame('error', {
        status: 502,
        title: 'Bad Gateway',
        detail: 'Answering failed in Langflow.',
        answerId: 'ans_9',
      }),
    );
    stream.end();

    expect(await running).toEqual({
      kind: 'failed',
      status: 502,
      detail: 'Answering failed in Langflow.',
    });
    expect(h.tokenTexts).toEqual(['RAG ']);
  });

  it('refuses a done record of the wrong shape instead of passing it on', async () => {
    const stream = openStream(new AbortController().signal);
    const h = harness([stream.response]);
    const running = h.run();
    stream.write(frame('done', { id: 'ans_1', latencyMs: 'soon' }));
    stream.end();

    expect(await running).toEqual({
      kind: 'failed',
      status: null,
      detail: 'The answer came back in an unexpected shape.',
    });
  });

  it('skips a token event without text rather than writing "undefined"', async () => {
    const stream = openStream(new AbortController().signal);
    const h = harness([stream.response]);
    const running = h.run();
    stream.write(frame('token', { nope: 1 }));
    stream.write(frame('token', { text: 'RAG' }));
    stream.write(frame('done', answer));
    stream.end();

    await running;
    expect(h.tokenTexts).toEqual(['RAG']);
  });

  it('stops reading once done arrives, without waiting for the server to close', async () => {
    const stream = openStream(new AbortController().signal);
    const h = harness([stream.response]);
    const running = h.run();
    stream.write(frame('done', answer));
    // The connection is deliberately left open, as an intermediary that buffers would leave it.

    expect(await running).toEqual({ kind: 'done', result: answer });
  });

  it('reads the problem detail of an HTTP error before the stream opens', async () => {
    const refused = new Response(JSON.stringify({ detail: 'Langflow is still starting.' }), { status: 503 });
    expect(await harness([refused]).run()).toEqual({
      kind: 'failed',
      status: 503,
      detail: 'Langflow is still starting.',
    });
  });

  it('fails when the stream ends without done or error', async () => {
    const stream = openStream(new AbortController().signal);
    const h = harness([stream.response]);
    const running = h.run();
    stream.write(frame('token', { text: 'half an ans' }));
    stream.end();

    expect(await running).toEqual({
      kind: 'failed',
      status: null,
      detail: 'The answer stopped before it finished.',
    });
  });

  // Stop can land before or after the first token is read; either way nothing is reported as a failure.
  it('reports a run the caller stopped as aborted, not as a failure', async () => {
    const controller = new AbortController();
    const stream = openStream(controller.signal);
    const h = harness([stream.response], controller);
    const running = h.run();
    stream.write(frame('token', { text: 'RAG ' }));
    controller.abort();

    expect(await running).toEqual({ kind: 'aborted' });
  });

  it('renews the token once on a 401 and reports an ended session as aborted', async () => {
    const h = harness([new Response(null, { status: 401 }), new Response(null, { status: 401 })]);
    expect(await h.run()).toEqual({ kind: 'aborted' });
    expect(h.auth.renewToken).toHaveBeenCalledTimes(1);
    expect(h.auth.endSession).toHaveBeenCalledTimes(1);
    expect(h.tokens).toEqual(['Bearer t1', 'Bearer t2']);
  });
});
