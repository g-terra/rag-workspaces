import { describe, expect, it } from 'vitest';
import { provisionApiKey } from './bootstrap.js';
import { LangflowClient } from './client.js';
import { LangflowError } from './errors.js';

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
  it('refuses keyed calls before it has a key', async () => {
    const client = new LangflowClient({ baseUrl: 'http://lf', fetch: fakeFetch(() => json({})).fn });
    await expect(client.listFlows()).rejects.toThrow(/no Langflow API key/);
  });

  it("turns errors into LangflowError with Langflow's own message", async () => {
    const { fn } = fakeFetch(() => json({ detail: { message: 'File not found: /data/uploads/x.pdf' } }, 500));
    const client = new LangflowClient({ baseUrl: 'http://lf', apiKey: 'k', fetch: fn });
    const err = await client.listFlows().catch((e: unknown) => e);
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
    const { fn, calls } = fakeFetch(() =>
      json([
        { id: '1', name: 'rw-answer', endpoint_name: 'rw-answer', data: null },
        { id: '2', name: 'Scratch' },
      ]),
    );
    const client = new LangflowClient({ baseUrl: 'http://lf', apiKey: 'k', fetch: fn });
    expect(await client.listFlows()).toEqual([
      { id: '1', name: 'rw-answer', endpoint_name: 'rw-answer' },
      { id: '2', name: 'Scratch', endpoint_name: null },
    ]);
    expect(calls[0]!.headers.get('x-api-key')).toBe('k');
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
