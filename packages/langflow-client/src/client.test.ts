import { describe, expect, it } from 'vitest';
import { provisionApiKey } from './bootstrap.js';
import { LangflowClient, parseEventStream } from './client.js';
import { LangflowError } from './errors.js';
import { messageText, outputsByComponent, parseJsonMessage } from './output.js';

type Call = { method: string; path: string; headers: Headers; body: string };

/** A fake fetch: answers from a list of handlers and records every call. */
function fakeFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      headers: new Headers(init?.headers),
      body: init?.body ? String(init.body) : '',
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('LangflowClient', () => {
  it('sends the API key and the run body, defaulting to chat input and output', async () => {
    const { fn, calls } = fakeFetch(() => json({ session_id: 's1', outputs: [] }));
    const client = new LangflowClient({ baseUrl: 'http://lf:7860/', apiKey: 'sk-1', fetch: fn });
    await client.run('rag-answer', {
      input_value: 'hi',
      session_id: 's1',
      tweaks: { LLM: { model_name: 'x' } },
    });
    expect(calls[0]!.path).toBe('/api/v1/run/rag-answer?stream=false');
    expect(calls[0]!.headers.get('x-api-key')).toBe('sk-1');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      input_type: 'chat',
      output_type: 'chat',
      input_value: 'hi',
      session_id: 's1',
      tweaks: { LLM: { model_name: 'x' } },
    });
  });

  it('refuses keyed calls before it has a key', async () => {
    const client = new LangflowClient({ baseUrl: 'http://lf', fetch: fakeFetch(() => json({})).fn });
    await expect(client.listFlows()).rejects.toThrow(/no Langflow API key/);
  });

  it("turns errors into LangflowError with Langflow's own message", async () => {
    const { fn } = fakeFetch(() => json({ detail: { message: 'File not found: /data/uploads/x.pdf' } }, 500));
    const client = new LangflowClient({ baseUrl: 'http://lf', apiKey: 'k', fetch: fn });
    const err = await client.run('rag-ingest', { session_id: 's' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LangflowError);
    expect(err).toMatchObject({ status: 500, detail: 'File not found: /data/uploads/x.pdf' });
  });

  it('retries login after a 429 using retry_after', async () => {
    let n = 0;
    const waits: number[] = [];
    const { fn } = fakeFetch(() =>
      ++n === 1 ? json({ retry_after: 2 }, 429) : json({ access_token: 'jwt' }),
    );
    const client = new LangflowClient({
      baseUrl: 'http://lf',
      fetch: fn,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(await client.login('admin', 'pw')).toBe('jwt');
    expect(waits).toEqual([2000]);
  });

  it('lists flows with their endpoint names', async () => {
    const { fn } = fakeFetch(() =>
      json([
        { id: '1', name: 'rag-answer', endpoint_name: 'rag-answer', data: null },
        { id: '2', name: 'Scratch' },
      ]),
    );
    const client = new LangflowClient({ baseUrl: 'http://lf', apiKey: 'k', fetch: fn });
    expect(await client.listFlows()).toEqual([
      { id: '1', name: 'rag-answer', endpoint_name: 'rag-answer' },
      { id: '2', name: 'Scratch', endpoint_name: null },
    ]);
  });

  it('healthy() is false when Langflow cannot be reached', async () => {
    const client = new LangflowClient({
      baseUrl: 'http://lf',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    expect(await client.healthy()).toBe(false);
  });
});

describe('provisionApiKey', () => {
  it('logs in, mints a new key and revokes only the keys it made before', async () => {
    const { fn, calls } = fakeFetch((c) => {
      if (c.path === '/api/v1/login') return json({ access_token: 'jwt' });
      if (c.method === 'GET') {
        return json({
          api_keys: [
            { id: 'a', name: 'rag-api-2026-11-19T10:00:00.000Z' },
            { id: 'b', name: 'my personal key' },
          ],
        });
      }
      if (c.method === 'POST') return json({ api_key: 'sk-new' });
      return json({});
    });
    const client = new LangflowClient({ baseUrl: 'http://lf', fetch: fn });
    const result = await provisionApiKey(client, {
      username: 'admin',
      password: 'pw',
      now: () => new Date('2026-11-20T12:00:00Z'),
    });
    expect(result).toEqual({ apiKey: 'sk-new', revoked: 1 });
    expect(JSON.parse(calls.find((c) => c.method === 'POST' && c.path === '/api/v1/api_key/')!.body)).toEqual(
      {
        name: 'rag-api-2026-11-20T12:00:00.000Z',
      },
    );
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/v1/api_key/a']);
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer jwt');
  });
});

describe('output helpers', () => {
  it('parses passages sent as fenced JSON inside a chat message', () => {
    const run = {
      outputs: [
        {
          outputs: [
            {
              component_id: 'ChatOutput-passages',
              results: { message: { text: '```json\n[{"document_id":"d1","score":0.8}]\n```' } },
            },
          ],
        },
      ],
    };
    const text = messageText(outputsByComponent(run)['ChatOutput-passages']);
    expect(parseJsonMessage(text)).toEqual([{ document_id: 'd1', score: 0.8 }]);
  });

  it('parses unfenced JSON too', () => {
    expect(parseJsonMessage('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('parseEventStream', () => {
  it('yields events split across chunks and skips junk lines', async () => {
    const enc = new TextEncoder();
    const parts = [
      '{"event":"token","data":{"chunk":"He"}}\n\n{"event":"tok',
      'en","data":{"chunk":"llo"}}\n',
      'not json\n',
      'data: {"event":"end","data":{}}',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    const events = [];
    for await (const ev of parseEventStream(body)) events.push(ev);
    expect(events.map((e) => e.event)).toEqual(['token', 'token', 'end']);
  });
});
