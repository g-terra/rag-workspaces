import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from './app.js';
import { loadConfig } from './config.js';
import type { ReadinessCheck } from './readiness.js';

const config = loadConfig({ NODE_ENV: 'test', READY_TIMEOUT_MS: '200' });
let app: App | undefined;

async function start(checks: ReadinessCheck[] = []) {
  app = await buildApp({ config, checks, logger: false });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health and readiness', () => {
  it('GET /health answers ok with a request id', async () => {
    const res = await (await start()).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('keeps a caller-supplied request id', async () => {
    const res = await (await start()).inject({ url: '/health', headers: { 'x-request-id': 'abc-123' } });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('GET /ready is ok when every check passes', async () => {
    const res = await (await start([{ name: 'db', check: async () => {} }])).inject({ url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready is 503 without detail when a check fails', async () => {
    const failing: ReadinessCheck = {
      name: 'chroma',
      check: async () => {
        throw new Error('connection refused');
      },
    };
    const res = await (await start([failing])).inject({ url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable' });
  });

  it('GET /ready is 503 when a check hangs past the timeout', async () => {
    const hanging: ReadinessCheck = { name: 'langflow', check: () => new Promise(() => {}) };
    const res = await (await start([hanging])).inject({ url: '/ready' });
    expect(res.statusCode).toBe(503);
  });
});

describe('docs and errors', () => {
  it('serves the OpenAPI spec with the system routes', async () => {
    const res = await (await start()).inject({ url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/health', '/ready']));
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await (await start()).inject({ url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('answers unknown routes with problem JSON', async () => {
    const res = await (await start()).inject({ url: '/nope?x=1' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404, title: 'Not Found', detail: 'No route for GET /nope' });
    expect(res.json().requestId).toBe(res.headers['x-request-id']);
  });
});

describe('config', () => {
  it('rejects a bad port with a readable message', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });
});

describe('config: optional values', () => {
  it('treats empty strings from compose as unset', () => {
    expect(loadConfig({ LANGFLOW_API_KEY: '' }).LANGFLOW_API_KEY).toBeUndefined();
  });
});
