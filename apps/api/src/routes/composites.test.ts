import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from '@rag/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { UploadStorage } from '../services/storage.js';
import { testKeycloak } from '../test/tokens.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('composite workspaces hold no documents (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  let root: string;
  const auth = { admin: '', outsider: '' };

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    root = await mkdtemp(path.join(tmpdir(), 'uploads-'));
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.outsider = `Bearer ${await kc.token({ sub: 'outsider-1' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, (async () =>
        Response.json({ id: 'cid' })) as typeof fetch),
      storage: new UploadStorage(root, 200_000),
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
    for (const slug of ['ouc', 'personal'])
      await call('POST', '/v1/workspaces', 'admin', { slug, name: slug });
    const res = await call('POST', '/v1/workspaces', 'admin', {
      slug: 'study',
      name: 'Study',
      kind: 'composite',
      sources: ['ouc', 'personal'],
    });
    expect(res.statusCode).toBe(201);
  });
  afterAll(async () => {
    await app?.close();
    await t?.drop();
    await rm(root, { recursive: true, force: true });
  });

  function call(method: string, path: string, who: keyof typeof auth = 'admin', payload?: object) {
    return app.inject({
      method: method as 'GET',
      url: path,
      headers: { authorization: auth[who] },
      ...(payload ? { payload } : {}),
    });
  }

  const doc = 'doc_01JD0000000000000000000000';
  it.each([
    ['GET', '/v1/workspaces/study/documents'],
    ['POST', '/v1/workspaces/study/documents'],
    ['GET', '/v1/workspaces/study/documents/events'],
    ['GET', `/v1/workspaces/study/documents/${doc}`],
    ['DELETE', `/v1/workspaces/study/documents/${doc}`],
    ['POST', `/v1/workspaces/study/documents/${doc}/reindex`],
    ['GET', '/v1/workspaces/study/folders'],
    ['POST', '/v1/workspaces/study/folders', { name: 'x' }],
    ['POST', '/v1/workspaces/study/reindex'],
  ] as const)('%s %s answers 409', async (method, path, payload?: object) => {
    const res = await call(method, path, 'admin', payload);
    expect(res.statusCode).toBe(409);
    expect(res.json().detail).toMatch(/composite/);
  });

  it('a caller with no access still gets 404, not 409', async () => {
    expect((await call('GET', '/v1/workspaces/study/documents', 'outsider')).statusCode).toBe(404);
  });

  it('the sources keep their own document routes', async () => {
    expect((await call('GET', '/v1/workspaces/ouc/documents')).statusCode).toBe(200);
    expect((await call('GET', '/v1/workspaces/ouc/folders')).statusCode).toBe(200);
  });
});
