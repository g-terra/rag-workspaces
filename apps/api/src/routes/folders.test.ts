import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { documents } from '@rag/db';
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

describe.skipIf(!url)('folders (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  let root: string;
  const auth = { admin: '', reader: '' };
  /** Metadata updates Chroma was asked for: `<vector id> folder=<value>`. */
  const moves: string[] = [];
  let chromaDown = false;

  const chromaFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (chromaDown) throw new TypeError('fetch failed');
    const target = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (target.endsWith('/get')) {
      // Every document has two vectors.
      const doc = body.where.document_id as string;
      return Response.json({ ids: [`${doc}:0`, `${doc}:1`] });
    }
    if (target.endsWith('/update')) {
      body.ids.forEach((id: string, i: number) => moves.push(`${id} folder=${body.metadatas[i].folder}`));
    }
    return Response.json({ id: 'cid' });
  }) as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    root = await mkdtemp(path.join(tmpdir(), 'uploads-'));
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, chromaFetch),
      storage: new UploadStorage(root, 200_000),
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
    for (const slug of ['ouc', 'personal'])
      await call('POST', '/v1/workspaces', 'admin', { slug, name: slug });
    await call('PUT', '/v1/workspaces/ouc/members/reader-1', 'admin', { role: 'reader' });
  });
  afterAll(async () => {
    await app?.close();
    await t?.drop();
    await rm(root, { recursive: true, force: true });
  });
  beforeEach(() => {
    moves.length = 0;
    chromaDown = false;
  });

  function call(method: string, path: string, who: keyof typeof auth = 'admin', payload?: object) {
    return app.inject({
      method: method as 'GET',
      url: path,
      headers: { authorization: auth[who] },
      ...(payload ? { payload } : {}),
    });
  }

  async function folder(name: string, slug = 'ouc') {
    const res = await call('POST', `/v1/workspaces/${slug}/folders`, 'admin', { name });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function upload(name: string, folderId?: string) {
    const form = new FormData();
    form.append('files', new Blob([`# ${name}\n\nSome notes about ${name}.`]), `${name}.md`);
    const req = new Request('http://local/', { method: 'POST', body: form });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/ouc/documents${folderId ? `?folderId=${folderId}` : ''}`,
      headers: { authorization: auth.admin, 'content-type': req.headers.get('content-type')! },
      payload: Buffer.from(await req.arrayBuffer()),
    });
    expect(res.statusCode).toBe(201);
    return res.json().data[0].document as { id: string; folderId: string | null };
  }

  it('creates, lists with document counts, and renames folders; names are unique ignoring case', async () => {
    const id = await folder('COS512');
    await upload('week-1', id);
    expect((await call('POST', '/v1/workspaces/ouc/folders', 'admin', { name: 'cos512' })).statusCode).toBe(
      409,
    );
    // The same name is fine in another workspace.
    await folder('COS512', 'personal');

    const list = (await call('GET', '/v1/workspaces/ouc/folders', 'reader')).json();
    expect(list.data).toEqual([
      expect.objectContaining({ id, name: 'COS512', workspace: 'ouc', documentCount: 1 }),
    ]);

    const renamed = await call('PATCH', `/v1/workspaces/ouc/folders/${id}`, 'admin', {
      name: 'COS512 notes',
    });
    expect(renamed.json()).toMatchObject({ id, name: 'COS512 notes', documentCount: 1 });
    expect(moves).toEqual([]); // passages carry the id, so a rename touches nothing in Chroma
  });

  it('readers can list but not change folders', async () => {
    expect((await call('POST', '/v1/workspaces/ouc/folders', 'reader', { name: 'x' })).statusCode).toBe(403);
  });

  it('uploads into a folder and filters the library by folder, or the top level', async () => {
    const id = await folder('Uploads');
    const inside = await upload('inside', id);
    const top = await upload('top');
    expect(inside.folderId).toBe(id);
    expect(top.folderId).toBeNull();
    const ids = async (q: string) =>
      (await call('GET', `/v1/workspaces/ouc/documents?${q}`)).json().data.map((d: { id: string }) => d.id);
    expect(await ids(`folderId=${id}`)).toEqual([inside.id]);
    expect(await ids('folderId=none')).toContain(top.id);
    expect(await ids('folderId=none')).not.toContain(inside.id);
  });

  it('refuses a folder of another workspace, or none, on upload and on move', async () => {
    const other = await folder('Elsewhere', 'personal');
    const form = new FormData();
    form.append('files', new Blob(['x']), 'x.md');
    const req = new Request('http://local/', { method: 'POST', body: form });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/ouc/documents?folderId=${other}`,
      headers: { authorization: auth.admin, 'content-type': req.headers.get('content-type')! },
      payload: Buffer.from(await req.arrayBuffer()),
    });
    expect(res.statusCode).toBe(404);
    const doc = await upload('stays');
    const move = await call('PATCH', `/v1/workspaces/ouc/documents/${doc.id}`, 'admin', { folderId: other });
    expect(move.statusCode).toBe(404);
  });

  it('moving a document moves its passages; null moves it to the top level', async () => {
    const id = await folder('Moves');
    const doc = await upload('mover');
    const moved = await call('PATCH', `/v1/workspaces/ouc/documents/${doc.id}`, 'admin', {
      folderId: id,
      title: 'Mover',
      tags: ['week-2'],
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ folderId: id, title: 'Mover', tags: ['week-2'] });
    expect(moves).toEqual([`${doc.id}:0 folder=${id}`, `${doc.id}:1 folder=${id}`]);

    moves.length = 0;
    const back = await call('PATCH', `/v1/workspaces/ouc/documents/${doc.id}`, 'admin', { folderId: null });
    expect(back.json().folderId).toBeNull();
    expect(moves).toEqual([`${doc.id}:0 folder=null`, `${doc.id}:1 folder=null`]);

    moves.length = 0;
    await call('PATCH', `/v1/workspaces/ouc/documents/${doc.id}`, 'admin', { tags: [] });
    expect(moves).toEqual([]); // retagging leaves Chroma alone
  });

  it('a move is refused while the document is ingested, and undone when Chroma is down', async () => {
    const id = await folder('Busy');
    const doc = await upload('busy');
    await t.db.update(documents).set({ status: 'processing' }).where(eq(documents.id, doc.id));
    const busy = await call('PATCH', `/v1/workspaces/ouc/documents/${doc.id}`, 'admin', { folderId: id });
    expect(busy.statusCode).toBe(409);

    await t.db.update(documents).set({ status: 'ready' }).where(eq(documents.id, doc.id));
    chromaDown = true;
    const down = await call('PATCH', `/v1/workspaces/ouc/documents/${doc.id}`, 'admin', { folderId: id });
    expect(down.statusCode).toBe(503);
    chromaDown = false;
    expect((await call('GET', `/v1/workspaces/ouc/documents/${doc.id}`)).json().folderId).toBeNull();
  });

  it('deleting a folder moves its documents and their passages to the top level', async () => {
    const id = await folder('Doomed');
    const doc = await upload('survivor', id);
    chromaDown = true;
    expect((await call('DELETE', `/v1/workspaces/ouc/folders/${id}`)).statusCode).toBe(503);
    chromaDown = false;
    expect((await call('GET', `/v1/workspaces/ouc/documents/${doc.id}`)).json().folderId).toBe(id);

    expect((await call('DELETE', `/v1/workspaces/ouc/folders/${id}`)).statusCode).toBe(204);
    expect(moves).toEqual([`${doc.id}:0 folder=null`, `${doc.id}:1 folder=null`]);
    expect((await call('GET', `/v1/workspaces/ouc/documents/${doc.id}`)).json().folderId).toBeNull();
    const left = (await call('GET', '/v1/workspaces/ouc/folders')).json().data;
    expect(left.map((f: { id: string }) => f.id)).not.toContain(id);
  });

  it('a folder with a document being ingested cannot be deleted', async () => {
    const id = await folder('Working');
    const doc = await upload('working', id);
    await t.db.update(documents).set({ status: 'processing' }).where(eq(documents.id, doc.id));
    expect((await call('DELETE', `/v1/workspaces/ouc/folders/${id}`)).statusCode).toBe(409);
  });
});
