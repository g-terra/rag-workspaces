import { providerKeys, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import type { WorkspaceProvider } from '@rag/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { withWorkspaceKeys } from '../services/provider-keys.js';
import { chatEndpoint } from '../services/providers.js';
import { sealSecret } from '../services/secrets.js';
import { testKeycloak } from '../test/tokens.js';

const url = process.env.TEST_DATABASE_URL;
const SECRETS_KEY = 'test-secrets-key-0123456789';

describe.skipIf(!url)('provider keys per workspace (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  const auth = { admin: '', alice: '' };
  /** Each provider call: the URL and the key it carried. */
  const calls: { url: string; key: string | null }[] = [];
  /** Keys the stand-in providers accept. */
  const valid = new Set([
    'env-gemini-key-000000000',
    'ws-gemini-key-00000001234',
    'ws-openai-key-00000005678',
  ]);
  const config = loadConfig({ NODE_ENV: 'test', SECRETS_KEY, GEMINI_API_KEY: 'env-gemini-key-000000000' });

  /** When set, hosted providers answer this status (an outage) instead of checking the key. */
  let outage: number | null = null;

  const providerFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (outage && !String(input).includes(':1234')) return new Response('{}', { status: outage });
    const headers = new Headers(init?.headers);
    const key = headers.get('authorization')?.replace(/^Bearer /, '') ?? headers.get('x-api-key');
    calls.push({ url: String(input), key });
    if (String(input).includes(':1234')) return Response.json({ data: [{ id: 'local-embed' }] });
    if (!key || !valid.has(key)) return new Response('{}', { status: 401 });
    return Response.json({ data: [{ id: `models/model-${[...valid].indexOf(key)}` }] });
  }) as typeof fetch;

  const chroma = new ChromaService(
    { CHROMA_URL: 'http://chroma:8000' },
    (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
  );

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.alice = `Bearer ${await kc.token({ sub: 'alice-1' })}`;
    app = await buildApp({
      config,
      db: t.db,
      chroma,
      providerFetch,
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
    for (const slug of ['ouc', 'personal']) {
      const res = await call('POST', '/v1/workspaces', 'admin', { slug, name: slug });
      expect(res.statusCode).toBe(201);
    }
    await call('PUT', '/v1/workspaces/ouc/members/alice-1', 'admin', { role: 'editor' });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  beforeEach(() => {
    calls.length = 0;
    outage = null;
  });

  function call(
    method: 'GET' | 'PUT' | 'DELETE' | 'POST',
    path: string,
    who: keyof typeof auth,
    payload?: object,
  ) {
    return app.inject({
      method,
      url: path,
      headers: { authorization: auth[who] },
      ...(payload ? { payload } : {}),
    });
  }

  const find = (list: WorkspaceProvider[], id: string) => list.find((p) => p.id === id)!;

  it('lists each provider with where its key comes from, asked with that key', async () => {
    const res = await call('GET', '/v1/workspaces/ouc/providers', 'admin');
    expect(res.statusCode).toBe(200);
    const list = res.json<WorkspaceProvider[]>();
    expect(list.map((p) => p.id)).toEqual(['lmstudio', 'openai', 'gemini', 'anthropic']);
    expect(find(list, 'gemini')).toMatchObject({
      configured: true,
      reachable: true,
      models: ['model-0'],
      key: { source: 'env', last4: null },
    });
    expect(find(list, 'openai')).toMatchObject({ configured: false, key: { source: null, last4: null } });
    expect(find(list, 'lmstudio').key).toEqual({ source: null, last4: null });
  });

  it('saves a key the provider accepts, never returns it, and stores it encrypted', async () => {
    const res = await call('PUT', '/v1/workspaces/ouc/providers/gemini/key', 'admin', {
      apiKey: 'ws-gemini-key-00000001234',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('ws-gemini-key');
    expect(res.json<WorkspaceProvider>()).toMatchObject({
      id: 'gemini',
      reachable: true,
      models: ['model-1'],
      key: { source: 'workspace', last4: '1234' },
    });
    // Checked against the provider before it was saved.
    expect(calls.some((c) => c.key === 'ws-gemini-key-00000001234')).toBe(true);

    const [row] = await t.db.select().from(providerKeys);
    expect(row).toMatchObject({ provider: 'gemini', last4: '1234', savedBy: 'admin-1' });
    expect(row!.sealed).not.toContain('ws-gemini-key');

    // The listing now asks Gemini with the workspace's key, not the one in .env.
    calls.length = 0;
    const list = (await call('GET', '/v1/workspaces/ouc/providers', 'admin')).json<WorkspaceProvider[]>();
    expect(find(list, 'gemini').key).toEqual({ source: 'workspace', last4: '1234' });
    expect(calls.find((c) => c.url.includes('generativelanguage'))?.key).toBe('ws-gemini-key-00000001234');
  });

  it('lets a reindex switch to a provider whose only key is the workspace one', async () => {
    // .env has no OpenAI key, so ouc's own is the only one.
    const saved = await call('PUT', '/v1/workspaces/ouc/providers/openai/key', 'admin', {
      apiKey: 'ws-openai-key-00000005678',
    });
    expect(saved.statusCode).toBe(200);
    const res = await call('POST', '/v1/workspaces/ouc/reindex', 'admin', {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    });
    expect(res.statusCode).toBe(202);
    expect((await call('DELETE', '/v1/workspaces/ouc/providers/openai/key', 'admin')).statusCode).toBe(204);
    // Without the workspace key, openai (no .env key either) is refused.
    const refused = await call('POST', '/v1/workspaces/personal/reindex', 'admin', {
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    });
    expect(refused.statusCode).toBe(422);
  });

  it('keeps the key to the workspace it was saved for', async () => {
    const list = (await call('GET', '/v1/workspaces/personal/providers', 'admin')).json<
      WorkspaceProvider[]
    >();
    expect(find(list, 'gemini').key.source).toBe('env');
  });

  it('gives the flows the workspace key, falling back to .env', async () => {
    const [ouc] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    const [personal] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'personal'));
    expect((await withWorkspaceKeys(t.db, config, ouc!.id)).GEMINI_API_KEY).toBe('ws-gemini-key-00000001234');
    expect((await withWorkspaceKeys(t.db, config, personal!.id)).GEMINI_API_KEY).toBe(
      'env-gemini-key-000000000',
    );
  });

  it('refuses a key the provider rejects, and saves nothing', async () => {
    const res = await call('PUT', '/v1/workspaces/ouc/providers/openai/key', 'admin', {
      apiKey: 'sk-wrong-key-0000000000',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toContain('refused the key');
    expect(res.body).not.toContain('sk-wrong-key-0000000000');
    expect(await t.db.select().from(providerKeys).where(eq(providerKeys.provider, 'openai'))).toEqual([]);
  });

  it('does not call a key bad when the provider is down or busy, and saves nothing', async () => {
    outage = 503;
    const res = await call('PUT', '/v1/workspaces/ouc/providers/openai/key', 'admin', {
      apiKey: 'ws-openai-key-00000005678',
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().detail).toContain("couldn't be asked");
    expect(await t.db.select().from(providerKeys).where(eq(providerKeys.provider, 'openai'))).toEqual([]);
  });

  it('a saved key that no longer opens is reported, and runs refuse it instead of using .env', async () => {
    const [ouc] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    // Sealed under another SECRETS_KEY, as after the key in .env was changed.
    await t.db.insert(providerKeys).values({
      workspaceId: ouc!.id,
      provider: 'anthropic',
      sealed: sealSecret('some-other-secrets-key', 'sk-ant-old', `${ouc!.id}:anthropic`),
      last4: '-old',
      savedBy: 'admin-1',
    });
    try {
      const list = (await call('GET', '/v1/workspaces/ouc/providers', 'admin')).json<WorkspaceProvider[]>();
      expect(find(list, 'anthropic')).toMatchObject({
        key: { source: 'workspace', last4: '-old' },
        error: expect.stringContaining("can't be read"),
      });
      // The provider was not asked with anything.
      expect(calls.some((c) => c.url.includes('anthropic'))).toBe(false);
      const keyed = await withWorkspaceKeys(t.db, { ...config, ANTHROPIC_API_KEY: 'env-anthropic' }, ouc!.id);
      expect(() => chatEndpoint({ chatProvider: 'anthropic', chatModel: 'claude' }, keyed)).toThrow(
        /saved for this workspace can't be read/,
      );
    } finally {
      await t.db.delete(providerKeys).where(eq(providerKeys.provider, 'anthropic'));
    }
  });

  it('needs a signed-in caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/workspaces/ouc/providers' });
    expect(res.statusCode).toBe(401);
  });

  it('has no key for LM Studio', async () => {
    const res = await call('PUT', '/v1/workspaces/ouc/providers/lmstudio/key', 'admin', {
      apiKey: 'whatever-key-0000000000',
    });
    expect(res.statusCode).toBe(400);
  });

  it('is for admins only', async () => {
    expect((await call('GET', '/v1/workspaces/ouc/providers', 'alice')).statusCode).toBe(403);
    expect(
      (
        await call('PUT', '/v1/workspaces/ouc/providers/openai/key', 'alice', {
          apiKey: 'ws-openai-key-00000005678',
        })
      ).statusCode,
    ).toBe(403);
    expect((await call('DELETE', '/v1/workspaces/ouc/providers/gemini/key', 'alice')).statusCode).toBe(403);
  });

  it('removes a saved key, so .env applies again', async () => {
    const res = await call('DELETE', '/v1/workspaces/ouc/providers/gemini/key', 'admin');
    expect(res.statusCode).toBe(204);
    const list = (await call('GET', '/v1/workspaces/ouc/providers', 'admin')).json<WorkspaceProvider[]>();
    expect(find(list, 'gemini').key).toEqual({ source: 'env', last4: null });
    expect((await call('DELETE', '/v1/workspaces/ouc/providers/gemini/key', 'admin')).statusCode).toBe(404);
  });

  it('goes with the workspace when it is deleted', async () => {
    await call('PUT', '/v1/workspaces/personal/providers/openai/key', 'admin', {
      apiKey: 'ws-openai-key-00000005678',
    });
    expect((await call('DELETE', '/v1/workspaces/personal', 'admin')).statusCode).toBe(204);
    expect(await t.db.select().from(providerKeys).where(eq(providerKeys.provider, 'openai'))).toEqual([]);
  });

  it('checks a key before any workspace exists, listing its models and storing nothing', async () => {
    const ok = await call('POST', '/v1/providers/openai/models', 'admin', {
      apiKey: 'ws-openai-key-00000005678',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: 'openai', reachable: true, models: ['models/model-2'] });
    const refused = await call('POST', '/v1/providers/openai/models', 'admin', {
      apiKey: 'sk-wrong-key-0000000000',
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().detail).toMatch(/^The key doesn't work: OpenAI refused the key/);
    expect(refused.body).not.toContain('sk-wrong-key');
    const lm = await call('POST', '/v1/providers/lmstudio/models', 'admin', {
      apiKey: 'whatever-key-0000000000',
    });
    expect(lm.statusCode).toBe(400);
    const member = await call('POST', '/v1/providers/openai/models', 'alice', {
      apiKey: 'ws-openai-key-00000005678',
    });
    expect(member.statusCode).toBe(403);
    expect(await t.db.select().from(providerKeys).where(eq(providerKeys.provider, 'openai'))).toEqual([]);
  });

  it('cannot save keys without SECRETS_KEY', async () => {
    const kc = await testKeycloak();
    const bare = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      providerFetch,
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
    const token = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    const res = await bare.inject({
      method: 'PUT',
      url: '/v1/workspaces/ouc/providers/openai/key',
      headers: { authorization: token },
      payload: { apiKey: 'ws-openai-key-00000005678' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toContain('SECRETS_KEY');
    await bare.close();
  });
});
