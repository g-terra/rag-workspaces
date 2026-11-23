import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { documents, newId, sites, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { UploadStorage } from '../services/storage.js';
import { testKeycloak } from '../test/tokens.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('sites (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  let root: string;
  const auth = { admin: '', reader: '', editor: '' };
  const crawled: string[] = [];
  /** What Chroma was asked: `delete <document id>` or `<vector id> folder=<value>`. */
  const chromaCalls: string[] = [];

  const chromaFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (target.endsWith('/get')) return Response.json({ ids: [`${body.where.document_id}:0`] });
    if (target.endsWith('/delete')) chromaCalls.push(`delete ${body.where.document_id}`);
    if (target.endsWith('/update'))
      body.ids.forEach((id: string, i: number) =>
        chromaCalls.push(`${id} folder=${body.metadatas[i].folder}`),
      );
    return Response.json({ id: 'cid' });
  }) as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    root = await mkdtemp(path.join(tmpdir(), 'uploads-'));
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    auth.editor = `Bearer ${await kc.token({ sub: 'editor-1' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, chromaFetch),
      storage: new UploadStorage(root, 200_000),
      crawls: { enqueue: async (id) => void crawled.push(id) },
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
    for (const slug of ['docs', 'other']) await call('POST', '/v1/workspaces', 'admin', { slug, name: slug });
    await call('PUT', '/v1/workspaces/docs/members/reader-1', 'admin', { role: 'reader' });
    await call('PUT', '/v1/workspaces/docs/members/editor-1', 'admin', { role: 'editor' });
  });
  afterAll(async () => {
    await app?.close();
    await t?.drop();
    await rm(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    crawled.length = 0;
    chromaCalls.length = 0;
  });

  function call(method: string, path: string, who: keyof typeof auth = 'admin', payload?: object) {
    return app.inject({
      method: method as 'GET',
      url: path,
      headers: { authorization: auth[who] },
      ...(payload ? { payload } : {}),
    });
  }

  /** A site with `n` ready pages, as a finished crawl leaves it. */
  async function siteWithPages(startUrl: string, n: number) {
    const res = await call('POST', '/v1/workspaces/docs/sites', 'editor', { url: startUrl });
    expect(res.statusCode).toBe(202);
    const site = res.json();
    await t.db.update(sites).set({ status: 'ready' }).where(eq(sites.id, site.id));
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'docs'));
    const ids: string[] = [];
    await mkdir(path.join(root, 'docs'), { recursive: true });
    for (let i = 0; i < n; i++) {
      const id = newId('document');
      await writeFile(path.join(root, 'docs', `${id}.md`), `# page ${i}`);
      await t.db.insert(documents).values({
        id,
        workspaceId: ws!.id,
        siteId: site.id,
        sourceUrl: `${site.scope}p${i}`,
        title: `page ${i}`,
        fileName: `${site.scope}p${i}`,
        type: 'web',
        sizeBytes: 6,
        sha256: id,
        storagePath: `docs/${id}.md`,
        status: 'ready',
      });
      ids.push(id);
    }
    chromaCalls.length = 0;
    crawled.length = 0;
    return { site, ids };
  }

  it('adds a site with its scope and default limits, and queues its crawl', async () => {
    const res = await call('POST', '/v1/workspaces/docs/sites', 'editor', {
      url: 'https://auth0.com/docs#intro',
      excludePaths: ['/docs/fr-ca/', '/docs/ja-jp/'],
    });
    expect(res.statusCode).toBe(202);
    const site = res.json();
    expect(site).toMatchObject({
      workspace: 'docs',
      startUrl: 'https://auth0.com/docs',
      scope: 'https://auth0.com/docs/',
      excludePaths: ['/docs/fr-ca/', '/docs/ja-jp/'],
      maxPages: 1000,
      maxDepth: 10,
      status: 'queued',
      documentCount: 0,
      pages: { found: 0, fetched: 0 },
    });
    expect(site.id).toMatch(/^site_/);
    expect(crawled).toEqual([site.id]);

    const again = await call('POST', '/v1/workspaces/docs/sites', 'editor', {
      url: 'https://auth0.com/docs',
    });
    expect(again.statusCode).toBe(409);
  });

  it('refuses bad input', async () => {
    for (const body of [
      { url: 'ftp://example.org/docs' },
      { url: 'not a url' },
      { url: 'https://example.org/', maxPages: 10_001 },
      { url: 'https://example.org/', maxDepth: 0 },
      { url: 'https://example.org/', excludePaths: ['fr-ca/'] },
      { url: 'https://example.org/', extra: true },
      { url: 'https://user:secret@example.org/docs' },
    ]) {
      expect(
        (await call('POST', '/v1/workspaces/docs/sites', 'editor', body)).statusCode,
        JSON.stringify(body),
      ).toBe(400);
    }
    const res = await call('POST', '/v1/workspaces/docs/sites', 'editor', {
      url: 'https://example.org/',
      folderId: 'fld_missing',
    });
    expect(res.statusCode).toBe(404);
  });

  it('lets readers list and read sites but not add them, and keeps workspaces apart', async () => {
    const { site } = await siteWithPages('https://readers.example.org/docs/', 2);
    const list = await call('GET', '/v1/workspaces/docs/sites', 'reader');
    expect(list.statusCode).toBe(200);
    expect(list.json().data.find((s: { id: string }) => s.id === site.id)).toMatchObject({
      documentCount: 2,
    });
    expect((await call('GET', `/v1/workspaces/docs/sites/${site.id}`, 'reader')).json()).toMatchObject({
      id: site.id,
      documentCount: 2,
    });
    expect(
      (await call('POST', '/v1/workspaces/docs/sites', 'reader', { url: 'https://x.org/' })).statusCode,
    ).toBe(403);
    expect((await call('GET', `/v1/workspaces/other/sites/${site.id}`)).statusCode).toBe(404);
    expect((await call('GET', '/v1/workspaces/other/sites', 'editor')).statusCode).toBe(404);
  });

  it('crawls again on request, once at a time', async () => {
    const { site } = await siteWithPages('https://again.example.org/', 0);
    const res = await call('POST', `/v1/workspaces/docs/sites/${site.id}/crawl`, 'editor');
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('queued');
    expect(crawled).toEqual([site.id]);
    expect((await call('POST', `/v1/workspaces/docs/sites/${site.id}/crawl`, 'editor')).statusCode).toBe(409);
  });

  it('changes limits, and moves existing pages with the folder', async () => {
    const { site, ids } = await siteWithPages('https://move.example.org/', 2);
    const folder = (await call('POST', '/v1/workspaces/docs/folders', 'admin', { name: 'Move docs' })).json();
    const res = await call('PATCH', `/v1/workspaces/docs/sites/${site.id}`, 'editor', {
      maxPages: 50,
      folderId: folder.id,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ maxPages: 50, folderId: folder.id });
    expect(chromaCalls.sort()).toEqual(ids.map((id) => `${id}:0 folder=${folder.id}`).sort());
    const pages = await t.db.select().from(documents).where(eq(documents.siteId, site.id));
    expect(pages.every((p) => p.folderId === folder.id)).toBe(true);
  });

  it('does not move pages while the site is crawling', async () => {
    const { site } = await siteWithPages('https://busy-move.example.org/', 1);
    await t.db.update(sites).set({ status: 'crawling' }).where(eq(sites.id, site.id));
    const folder = (await call('POST', '/v1/workspaces/docs/folders', 'admin', { name: 'Busy move' })).json();
    const res = await call('PATCH', `/v1/workspaces/docs/sites/${site.id}`, 'editor', {
      folderId: folder.id,
    });
    expect(res.statusCode).toBe(409);
    expect(chromaCalls).toEqual([]);
    // Limits can still change: they apply from the next crawl.
    expect(
      (await call('PATCH', `/v1/workspaces/docs/sites/${site.id}`, 'editor', { maxPages: 5 })).statusCode,
    ).toBe(200);
  });

  it('removes a site with its pages, vectors and files, but not while a page is being ingested', async () => {
    const { site, ids } = await siteWithPages('https://remove.example.org/', 2);
    await t.db.update(documents).set({ status: 'processing' }).where(eq(documents.id, ids[0]!));
    expect((await call('DELETE', `/v1/workspaces/docs/sites/${site.id}`, 'editor')).statusCode).toBe(409);
    // Nothing was deleted: not the idle page, not its vectors.
    expect(await t.db.select().from(documents).where(eq(documents.siteId, site.id))).toHaveLength(2);
    expect(chromaCalls).toEqual([]);
    expect((await call('DELETE', `/v1/workspaces/docs/sites/${site.id}`, 'reader')).statusCode).toBe(403);

    await t.db.update(documents).set({ status: 'ready' }).where(eq(documents.id, ids[0]!));
    expect((await call('DELETE', `/v1/workspaces/docs/sites/${site.id}`, 'editor')).statusCode).toBe(204);
    expect(chromaCalls.sort()).toEqual(ids.map((id) => `delete ${id}`).sort());
    expect(await t.db.select().from(documents).where(eq(documents.siteId, site.id))).toEqual([]);
    expect((await call('GET', `/v1/workspaces/docs/sites/${site.id}`)).statusCode).toBe(404);
  });

  it('shows pages as documents with their source URL', async () => {
    const { ids } = await siteWithPages('https://show.example.org/', 1);
    const doc = (await call('GET', `/v1/workspaces/docs/documents/${ids[0]}`, 'reader')).json();
    expect(doc).toMatchObject({ type: 'web', sourceUrl: 'https://show.example.org/p0' });
    expect(doc.siteId).toMatch(/^site_/);
  });
});
