import type { ProviderStatus } from '@rag/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { DEFAULT_SYSTEM_PROMPT } from '../services/generate.js';
import type { ReadinessCheck } from '../readiness.js';
import { testKeycloak } from '../test/tokens.js';
import { VERSION } from '../version.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DEFAULT_CHAT_PROVIDER: 'lmstudio',
  DEFAULT_CHAT_MODEL: 'qwen',
  DEFAULT_EMBEDDING_PROVIDER: 'lmstudio',
  DEFAULT_EMBEDDING_MODEL: 'nomic',
  DEFAULT_CHUNK_SIZE: '900',
  DEFAULT_CHUNK_OVERLAP: '120',
  DEFAULT_TOP_K: '6',
  DEFAULT_MIN_SCORE: '0.4',
  DEFAULT_REASONING_EFFORT: 'none',
});
let kc: Awaited<ReturnType<typeof testKeycloak>>;
let app: App | undefined;
const tokens = { admin: '', alice: '' };

beforeAll(async () => {
  kc = await testKeycloak();
  tokens.admin = await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } });
  tokens.alice = await kc.token({ sub: 'alice-1' });
});
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const ok = (name: string): ReadinessCheck => ({ name, check: async () => {} });
const lmstudio = (models: string[], reachable = true): ProviderStatus => ({
  id: 'lmstudio',
  configured: true,
  reachable,
  error: reachable ? null : 'could not reach LM Studio',
  models,
  embeddings: true,
});

async function get(who: keyof typeof tokens | null, checks: ReadinessCheck[], providers: ProviderStatus[]) {
  app = await buildApp({
    config,
    logger: false,
    authenticators: [keycloakAuthenticator(kc.options)],
    checks,
    models: { status: async () => providers },
    langflowKey: () => 'auto',
  });
  return app.inject({
    method: 'GET',
    url: '/v1/system',
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
  });
}

describe('GET /v1/system', () => {
  it('reports every service, the providers and the defaults', async () => {
    const res = await get('admin', [ok('postgres'), ok('chroma')], [lmstudio(['nomic', 'qwen'])]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      version: VERSION,
      status: 'ok',
      services: [
        { name: 'postgres', ok: true, latencyMs: expect.any(Number), error: null },
        { name: 'chroma', ok: true, latencyMs: expect.any(Number), error: null },
      ],
      langflowKey: 'auto',
      providers: [lmstudio(['nomic', 'qwen'])],
      defaults: {
        chat: { provider: 'lmstudio', model: 'qwen', available: true },
        embedding: { provider: 'lmstudio', model: 'nomic', available: true },
        workspace: {
          chunkSize: 900,
          chunkOverlap: 120,
          topK: 6,
          minScore: 0.4,
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          reasoningEffort: 'none',
        },
      },
    });
  });

  it('is degraded, still 200, when a service fails, with the reason', async () => {
    const down: ReadinessCheck = {
      name: 'langflow',
      check: async () => {
        throw new Error('flows missing in Langflow: rw-chat');
      },
    };
    const res = await get('admin', [ok('postgres'), down], [lmstudio(['nomic', 'qwen'])]);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('degraded');
    expect(res.json().services[1]).toMatchObject({
      name: 'langflow',
      ok: false,
      error: 'flows missing in Langflow: rw-chat',
    });
  });

  it('is degraded when a default model is not offered or LM Studio is down', async () => {
    const missing = (await get('admin', [], [lmstudio(['nomic'])])).json();
    expect(missing.status).toBe('degraded');
    expect(missing.defaults.chat.available).toBe(false);
    expect(missing.defaults.embedding.available).toBe(true);
    await app?.close();
    const down = (await get('admin', [], [lmstudio([], false)])).json();
    expect(down.defaults).toMatchObject({ chat: { available: false }, embedding: { available: false } });
  });

  it('is for admins only', async () => {
    expect((await get('alice', [], [])).statusCode).toBe(403);
    await app?.close();
    expect((await get(null, [], [])).statusCode).toBe(401);
  });
});
