import { LangflowClient } from '@rag/langflow-client';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { LangflowService } from './langflow.js';

const log = pino({ level: 'silent' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fake Langflow: login works unless `loginFails`, flows are whatever `flows` holds. */
function fakeLangflow(opts: { loginFails?: boolean; flows?: string[]; healthy?: boolean } = {}) {
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    if (path === '/health_check') return json({}, opts.healthy === false ? 503 : 200);
    if (path === '/api/v1/login')
      return opts.loginFails ? json({ detail: 'bad' }, 401) : json({ access_token: 't' });
    if (path === '/api/v1/api_key/' && method === 'GET') return json({ api_keys: [] });
    if (path === '/api/v1/api_key/' && method === 'POST') return json({ api_key: 'sk-auto' });
    if (path === '/api/v1/flows/')
      return json((opts.flows ?? []).map((n, i) => ({ id: `${i}`, name: n, endpoint_name: n })));
    return json({}, 404);
  }) as typeof fetch;
  return new LangflowClient({ baseUrl: 'http://lf', fetch: fetchFn, sleep: async () => {} });
}

const ALL_FLOWS = ['rag-ingest', 'rag-retrieve', 'rag-answer', 'rag-delete'];
const base = { LANGFLOW_URL: 'http://lf', LANGFLOW_SUPERUSER: 'admin' };
const signal = new AbortController().signal;

describe('LangflowService', () => {
  it('creates its own key by signing in as the superuser', async () => {
    const svc = new LangflowService({
      config: { ...base, LANGFLOW_SUPERUSER_PASSWORD: 'pw', LANGFLOW_API_KEY: 'sk-env' },
      log,
      client: fakeLangflow({ flows: ALL_FLOWS }),
    });
    await svc.start();
    expect(svc.keySource).toBe('auto');
    await expect(svc.readinessCheck().check(signal)).resolves.toBeUndefined();
  });

  it('falls back to LANGFLOW_API_KEY when signing in fails', async () => {
    const svc = new LangflowService({
      config: { ...base, LANGFLOW_SUPERUSER_PASSWORD: 'wrong', LANGFLOW_API_KEY: 'sk-env' },
      log,
      client: fakeLangflow({ loginFails: true, flows: ALL_FLOWS }),
    });
    await svc.start();
    expect(svc.keySource).toBe('env');
  });

  it('keeps retrying in the background when there is no fallback', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeLangflow({ loginFails: true });
      const login = vi.spyOn(client, 'login');
      const svc = new LangflowService({
        config: { ...base, LANGFLOW_SUPERUSER_PASSWORD: 'pw' },
        log,
        client,
        retryDelayMs: () => 1000,
      });
      await svc.start();
      expect(svc.keySource).toBe('none');
      await vi.advanceTimersByTimeAsync(2500);
      expect(login).toHaveBeenCalledTimes(3);
      svc.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not ready without a key', async () => {
    const svc = new LangflowService({ config: base, log, client: fakeLangflow({ flows: ALL_FLOWS }) });
    await svc.start();
    await expect(svc.readinessCheck().check(signal)).rejects.toThrow(/no Langflow API key/);
  });

  it('is not ready when a flow is missing, and names it', async () => {
    const svc = new LangflowService({
      config: { ...base, LANGFLOW_API_KEY: 'sk-env' },
      log,
      client: fakeLangflow({ flows: ['rag-ingest', 'rag-retrieve'] }),
    });
    await svc.start();
    await expect(svc.readinessCheck().check(signal)).rejects.toThrow(
      'flows missing in Langflow: rag-answer, rag-delete',
    );
  });

  it('is not ready when Langflow is unhealthy', async () => {
    const svc = new LangflowService({
      config: { ...base, LANGFLOW_API_KEY: 'k' },
      log,
      client: fakeLangflow({ healthy: false }),
    });
    await svc.start();
    await expect(svc.readinessCheck().check(signal)).rejects.toThrow(/health check/);
  });
});
