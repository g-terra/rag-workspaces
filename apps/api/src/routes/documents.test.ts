import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestDatabase } from '@rag/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { apiKeyAuthenticator } from '../auth/api-keys.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { UploadStorage } from '../services/storage.js';
import { testKeycloak } from '../test/tokens.js';

const samples = path.resolve(import.meta.dirname, '../../../../poc/samples');
const url = process.env.TEST_DATABASE_URL;

/** Build a multipart body the way a browser would. */
async function multipart(files: { name: string; content: Buffer | string }[]) {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.content]), f.name);
  const req = new Request('http://local/', { method: 'POST', body: form });
  return { payload: Buffer.from(await req.arrayBuffer()), contentType: req.headers.get('content-type')! };
}

describe.skipIf(!url)('documents (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  let root: string;
  const queued: string[] = [];
  const chromaCalls: string[] = [];
  const auth = { admin: '', reader: '' };

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    root = await mkdtemp(path.join(tmpdir(), 'uploads-'));
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    const chromaFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      chromaCalls.push(
        `${init?.method ?? 'GET'} ${String(input).split('/databases/default_database')[1] ?? input}`,
      );
      return new Response(JSON.stringify({ id: 'cid' }), { status: 200 });
    }) as typeof fetch;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', MAX_UPLOAD_BYTES: '200000' }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, chromaFetch),
      storage: new UploadStorage(root, 200_000),
      queue: { enqueue: async (id) => void queued.push(id) },
      logger: false,
      authenticators: [apiKeyAuthenticator(t.db), keycloakAuthenticator(kc.options)],
    });
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: { authorization: auth.admin },
      payload: { slug: 'ouc', name: 'OUC' },
    });
    await app.inject({
      method: 'PUT',
      url: '/v1/workspaces/ouc/members/reader-1',
      headers: { authorization: auth.admin },
      payload: { role: 'reader' },
    });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
    await rm(root, { recursive: true, force: true });
  });

  async function upload(
    files: { name: string; content: Buffer | string }[],
    who: 'admin' | 'reader' = 'admin',
  ) {
    const { payload, contentType } = await multipart(files);
    return app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/documents',
      headers: { authorization: auth[who], 'content-type': contentType },
      payload,
    });
  }

  it('uploads the four sample types, stores them and queues each for ingestion', async () => {
    const files = await Promise.all(
      [
        'ouc/cos512-notes.pdf',
        'ouc/assignment-brief.docx',
        'ouc/langflow-tips.md',
        'personal/recipes.txt',
      ].map(async (f) => ({ name: path.basename(f), content: await readFile(path.join(samples, f)) })),
    );
    const res = await upload(files);
    expect(res.statusCode).toBe(201);
    const data = res.json().data as {
      document: { id: string; type: string; status: string; title: string };
      duplicate: boolean;
    }[];
    expect(data.map((d) => [d.document.type, d.document.status, d.duplicate])).toEqual([
      ['pdf', 'queued', false],
      ['docx', 'queued', false],
      ['md', 'queued', false],
      ['txt', 'queued', false],
    ]);
    expect(data[0]!.document.title).toBe('cos512-notes');
    expect(queued).toEqual(data.map((d) => d.document.id));
    const stored = (await readdir(path.join(root, 'ouc'))).filter((f) => !f.startsWith('.'));
    expect(stored.sort()).toEqual(data.map((d) => `${d.document.id}.${d.document.type}`).sort());
  });

  it('an identical file is a duplicate: same document back, nothing stored or queued', async () => {
    const before = queued.length;
    const res = await upload([
      { name: 'renamed.txt', content: await readFile(path.join(samples, 'personal/recipes.txt')) },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().data[0]).toMatchObject({ duplicate: true, document: { fileName: 'recipes.txt' } });
    expect(queued.length).toBe(before);
  });

  it('415 for an unsupported file, and nothing from that request is kept', async () => {
    const res = await upload([
      { name: 'fine.md', content: '# a new note' },
      { name: 'image.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]) },
    ]);
    expect(res.statusCode).toBe(415);
    expect(res.json().detail).toContain('image.png');
    const list = await app.inject({
      url: '/v1/workspaces/ouc/documents',
      headers: { authorization: auth.admin },
    });
    expect(list.json().data.map((d: { fileName: string }) => d.fileName)).not.toContain('fine.md');
    expect(await readdir(path.join(root, 'ouc', '.incoming'))).toEqual([]);
  });

  it('413 for a file over the limit', async () => {
    const res = await upload([{ name: 'big.txt', content: 'a'.repeat(250_000) }]);
    expect(res.statusCode).toBe(413);
  });

  it('readers can list and download but not upload or delete', async () => {
    expect((await upload([{ name: 'x.md', content: '# x' }], 'reader')).statusCode).toBe(403);
    const list = await app.inject({
      url: '/v1/workspaces/ouc/documents?type=md',
      headers: { authorization: auth.reader },
    });
    expect(list.statusCode).toBe(200);
    const md = list.json().data[0];
    expect(md.type).toBe('md');
    const file = await app.inject({
      url: `/v1/workspaces/ouc/documents/${md.id}/file`,
      headers: { authorization: auth.reader },
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('text/markdown');
    expect(file.body).toContain('Langflow');
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/workspaces/ouc/documents/${md.id}`,
      headers: { authorization: auth.reader },
    });
    expect(del.statusCode).toBe(403);
  });

  it('deleting removes vectors, row and file', async () => {
    const list = await app.inject({
      url: '/v1/workspaces/ouc/documents?type=txt',
      headers: { authorization: auth.admin },
    });
    const doc = list.json().data[0];
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/workspaces/ouc/documents/${doc.id}`,
      headers: { authorization: auth.admin },
    });
    expect(res.statusCode).toBe(204);
    expect(chromaCalls).toContain('POST /collections/cid/delete');
    expect(
      (
        await app.inject({
          url: `/v1/workspaces/ouc/documents/${doc.id}`,
          headers: { authorization: auth.admin },
        })
      ).statusCode,
    ).toBe(404);
    expect(await readdir(path.join(root, 'ouc'))).not.toContain(`${doc.id}.txt`);
  });
});
