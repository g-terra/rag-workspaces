import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { auth } from './auth/plugin.js';
import type { Authenticator } from './auth/principal.js';
import { errorHandler } from './errors.js';
import { FixedWindow, rateLimits } from './rate-limit.js';

/** Two API keys, `rw_a` and `rw_b`; anything else is anonymous. */
const keys: Authenticator = async (credential) =>
  credential.startsWith('rw_')
    ? { kind: 'key', id: credential, name: credential, role: 'reader', workspaces: [] }
    : null;

async function server(limits: { all: number; model: number }) {
  let now = 1_000_000;
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(auth, { authenticators: [keys] });
  await app.register(rateLimits, {
    config: { RATE_LIMIT_PER_MINUTE: limits.all, RATE_LIMIT_MODEL_PER_MINUTE: limits.model },
    now: () => now,
  });
  app.get('/v1/list', async () => ({ ok: true }));
  app.post('/v1/ask', { config: { modelCall: true } }, async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));
  const call = (method: 'GET' | 'POST', url: string, key?: string) =>
    app.inject({ method, url, headers: key ? { authorization: `Bearer ${key}` } : {} });
  return { app, call, advance: (ms: number) => (now += ms) };
}

describe('FixedWindow', () => {
  it('counts per key and starts again when the minute is up', () => {
    let now = 0;
    const w = new FixedWindow(2, 60_000, () => now);
    expect(w.hit('a')).toEqual({ allowed: true, limit: 2, remaining: 1, resetSeconds: 60 });
    expect(w.hit('a').allowed).toBe(true);
    now = 45_000;
    expect(w.hit('a')).toEqual({ allowed: false, limit: 2, remaining: 0, resetSeconds: 15 });
    expect(w.hit('b').allowed).toBe(true);
    now = 60_000;
    expect(w.hit('a')).toMatchObject({ allowed: true, remaining: 1 });
  });
});

describe('rate limits', () => {
  it('limits each caller separately, with RateLimit headers and a 429 problem', async () => {
    const { app, call, advance } = await server({ all: 3, model: 0 });
    const first = await call('GET', '/v1/list', 'rw_a');
    expect(first.headers).toMatchObject({
      'ratelimit-limit': '3',
      'ratelimit-remaining': '2',
      'ratelimit-reset': '60',
    });
    await call('GET', '/v1/list', 'rw_a');
    await call('GET', '/v1/list', 'rw_a');
    advance(20_000);
    const over = await call('GET', '/v1/list', 'rw_a');
    expect(over.statusCode).toBe(429);
    expect(over.headers['retry-after']).toBe('40');
    expect(over.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(over.json().detail).toBe('Too many requests: the limit is 3 a minute. Try again in 40 s.');
    expect((await call('GET', '/v1/list', 'rw_b')).statusCode).toBe(200);
    advance(40_000);
    expect((await call('GET', '/v1/list', 'rw_a')).statusCode).toBe(200);
    await app.close();
  });

  it('model calls have their own, tighter limit, and still count as requests', async () => {
    const { app, call } = await server({ all: 5, model: 2 });
    expect((await call('POST', '/v1/ask', 'rw_a')).headers['ratelimit-limit']).toBe('2');
    await call('POST', '/v1/ask', 'rw_a');
    const over = await call('POST', '/v1/ask', 'rw_a');
    expect(over.statusCode).toBe(429);
    expect(over.json().detail).toMatch(
      /^Too many searches, answers and chat messages: the limit is 2 a minute/,
    );
    // Other routes still work, with what is left of the request limit (3 of 5 used).
    const list = await call('GET', '/v1/list', 'rw_a');
    expect(list.statusCode).toBe(200);
    expect(list.headers).toMatchObject({ 'ratelimit-limit': '5', 'ratelimit-remaining': '1' });
    await app.close();
  });

  it('leaves anonymous requests, routes outside /v1 and a limit of 0 alone', async () => {
    const { app, call } = await server({ all: 1, model: 0 });
    for (let i = 0; i < 3; i++) {
      expect((await call('GET', '/v1/list')).statusCode).toBe(200);
      expect((await call('GET', '/health', 'rw_a')).headers['ratelimit-limit']).toBeUndefined();
    }
    for (let i = 0; i < 3; i++)
      expect((await call('POST', '/v1/ask', 'rw_b')).statusCode).toBe(i ? 429 : 200);
    await app.close();
    const off = await server({ all: 0, model: 0 });
    for (let i = 0; i < 3; i++)
      expect((await off.call('GET', '/v1/list', 'rw_a')).headers['ratelimit-limit']).toBeUndefined();
    await off.app.close();
  });
});
