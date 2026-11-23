import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { documents } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { apiKeyAuthenticator } from '../auth/api-keys.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { DocumentEvents } from '../services/document-events.js';
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
  const events = new DocumentEvents();
  const chromaCalls: string[] = [];
  const auth = { admin: '', reader: '', editor: '', stranger: '' };
  let chromaDown = false;

  // Routes read WHISPER_URL per request, so a test can switch the video profile on.
  const config = loadConfig({ NODE_ENV: 'test', MAX_UPLOAD_BYTES: '200000' });

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    root = await mkdtemp(path.join(tmpdir(), 'uploads-'));
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    auth.editor = `Bearer ${await kc.token({ sub: 'editor-1' })}`;
    auth.stranger = `Bearer ${await kc.token({ sub: 'stranger-1' })}`;
    const chromaFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (chromaDown) throw new TypeError('fetch failed');
      chromaCalls.push(
        `${init?.method ?? 'GET'} ${String(input).split('/databases/default_database')[1] ?? input}`,
      );
      return new Response(JSON.stringify({ id: 'cid' }), { status: 200 });
    }) as typeof fetch;
    app = await buildApp({
      config,
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, chromaFetch),
      storage: new UploadStorage(root, 200_000),
      queue: { enqueue: async (id) => void queued.push(id) },
      events,
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
      method: 'POST',
      url: '/v1/workspaces',
      headers: { authorization: auth.admin },
      payload: { slug: 'personal', name: 'Personal' },
    });
    for (const [user, role] of [
      ['reader-1', 'reader'],
      ['editor-1', 'editor'],
    ]) {
      await app.inject({
        method: 'PUT',
        url: `/v1/workspaces/ouc/members/${user}`,
        headers: { authorization: auth.admin },
        payload: { role },
      });
    }
  });

  function get(url: string, who: keyof typeof auth = 'admin') {
    return app.inject({ url, headers: { authorization: auth[who] } });
  }

  function del(url: string, who: keyof typeof auth = 'admin') {
    return app.inject({ method: 'DELETE', url, headers: { authorization: auth[who] } });
  }

  afterAll(async () => {
    await app?.close();
    await t?.drop();
    await rm(root, { recursive: true, force: true });
  });

  async function upload(
    files: { name: string; content: Buffer | string }[],
    who: keyof typeof auth = 'admin',
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

  it('reindex puts a document back in the queue with a fresh attempt count', async () => {
    const list = await app.inject({
      url: '/v1/workspaces/ouc/documents?type=pdf',
      headers: { authorization: auth.admin },
    });
    const doc = list.json().data[0];
    const before = queued.length;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/ouc/documents/${doc.id}/reindex`,
      headers: { authorization: auth.admin },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'queued', attempts: 0, error: null });
    expect(queued.slice(before)).toEqual([doc.id]);
  });

  it('reindex needs an editor of that workspace', async () => {
    const pdf = (await get('/v1/workspaces/ouc/documents?type=pdf')).json().data[0];
    const reindex = (slug: string, who: keyof typeof auth) =>
      app.inject({
        method: 'POST',
        url: `/v1/workspaces/${slug}/documents/${pdf.id}/reindex`,
        headers: { authorization: auth[who] },
      });
    expect((await reindex('ouc', 'reader')).statusCode).toBe(403);
    expect((await reindex('ouc', 'stranger')).statusCode).toBe(404);
    expect((await reindex('personal', 'admin')).statusCode).toBe(404);
  });

  it('409 for reindex or delete while a document is being ingested', async () => {
    const pdf = (await get('/v1/workspaces/ouc/documents?type=pdf')).json().data[0];
    await t.db.update(documents).set({ status: 'processing' }).where(eq(documents.id, pdf.id));
    try {
      const reindex = await app.inject({
        method: 'POST',
        url: `/v1/workspaces/ouc/documents/${pdf.id}/reindex`,
        headers: { authorization: auth.admin },
      });
      expect(reindex.statusCode).toBe(409);
      expect((await del(`/v1/workspaces/ouc/documents/${pdf.id}`)).statusCode).toBe(409);
    } finally {
      await t.db.update(documents).set({ status: 'queued' }).where(eq(documents.id, pdf.id));
    }
  });

  it('the status stream needs access to the workspace', async () => {
    const url = '/v1/workspaces/ouc/documents/events';
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await get(url, 'stranger')).statusCode).toBe(404);
  });

  it('upload, reindex and delete each announce the change', async () => {
    const seen: string[] = [];
    const stop = events.subscribe((e) => seen.push(e.removed ? 'removed' : e.document.status));
    try {
      const id = (await upload([{ name: 'announce.md', content: '# announce' }])).json().data[0].document.id;
      await app.inject({
        method: 'POST',
        url: `/v1/workspaces/ouc/documents/${id}/reindex`,
        headers: { authorization: auth.admin },
      });
      await del(`/v1/workspaces/ouc/documents/${id}`);
    } finally {
      stop();
    }
    expect(seen).toEqual(['queued', 'queued', 'removed']);
  });

  it('streams a snapshot of unfinished documents, then status changes for this workspace only', async () => {
    const { payload, contentType } = await multipart([{ name: 'other.md', content: '# other workspace' }]);
    const other = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/personal/documents',
      headers: { authorization: auth.admin, 'content-type': contentType },
      payload,
    });
    const otherId = other.json().data[0].document.id;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/v1/workspaces/ouc/documents/events`, {
      headers: { authorization: auth.reader },
      signal: ctrl.signal,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    const nextEvent = async () => {
      while (!buffer.includes('\n\n')) buffer += (await reader.read()).value ?? '';
      const [block, ...rest] = buffer.split('\n\n');
      buffer = rest.join('\n\n');
      const event = /^event: (.+)$/m.exec(block!)![1];
      return { event, data: JSON.parse(/^data: (.+)$/m.exec(block!)![1]!) };
    };

    const snapshot = await nextEvent();
    expect(snapshot.event).toBe('snapshot');
    expect(snapshot.data.data.every((d: { status: string }) => d.status === 'queued')).toBe(true);
    expect(snapshot.data.data.length).toBeGreaterThan(0);
    expect(snapshot.data.data.map((d: { id: string }) => d.id)).not.toContain(otherId);

    const [row] = await t.db.select().from(documents).limit(1);
    events.emit({ workspaceId: 'ws_other', document: { ...row!, status: 'ready' } });
    events.emit({ workspaceId: row!.workspaceId, document: { ...row!, status: 'processing' } });
    const change = await nextEvent();
    expect(change).toMatchObject({
      event: 'document',
      data: { id: row!.id, status: 'processing', workspace: 'ouc' },
    });
    ctrl.abort();
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

  it('video and audio need the video profile; with it they are stored, with a transcript route', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF\x24\x08\x00\x00WAVEfmt ', 'latin1'), Buffer.alloc(64)]);
    const off = await upload([{ name: 'memo.wav', content: wav }]);
    expect(off.statusCode).toBe(415);
    expect(off.json().detail).toContain('video profile');

    config.WHISPER_URL = 'http://whisper:9000';
    try {
      const res = await upload([{ name: 'memo.wav', content: wav }]);
      expect(res.statusCode).toBe(201);
      const doc = res.json().data[0].document;
      expect(doc).toMatchObject({ type: 'wav', fileName: 'memo.wav', status: 'queued' });
      // Not transcribed yet.
      expect((await get(`/v1/workspaces/ouc/documents/${doc.id}/transcript`, 'reader')).statusCode).toBe(404);

      const transcript = { language: 'en', segments: [{ start: 0, end: 2.5, text: 'Hello.' }] };
      await writeFile(path.join(root, 'ouc', `${doc.id}.wav.transcript.json`), JSON.stringify(transcript));
      const read = await get(`/v1/workspaces/ouc/documents/${doc.id}/transcript`, 'reader');
      expect(read.statusCode).toBe(200);
      expect(read.json()).toEqual(transcript);
      const file = await get(`/v1/workspaces/ouc/documents/${doc.id}/file`, 'reader');
      expect(file.headers['content-type']).toBe('audio/wav');

      expect((await del(`/v1/workspaces/ouc/documents/${doc.id}`)).statusCode).toBe(204);
      const left = await readdir(path.join(root, 'ouc'));
      expect(left.filter((f) => f.startsWith(doc.id))).toEqual([]);
    } finally {
      config.WHISPER_URL = undefined;
    }
  });

  it('400 for an empty file', async () => {
    const res = await upload([{ name: 'empty.md', content: '' }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('empty.md');
  });

  it('editors can upload and delete', async () => {
    const res = await upload([{ name: 'editor.md', content: '# from an editor' }], 'editor');
    expect(res.statusCode).toBe(201);
    const id = res.json().data[0].document.id;
    expect((await del(`/v1/workspaces/ouc/documents/${id}`, 'editor')).statusCode).toBe(204);
  });

  it('a document is only found through its own workspace, and strangers see 404', async () => {
    const md = (await get('/v1/workspaces/ouc/documents?type=md')).json().data[0];
    expect((await get(`/v1/workspaces/personal/documents/${md.id}`)).statusCode).toBe(404);
    expect((await get(`/v1/workspaces/personal/documents/${md.id}/file`)).statusCode).toBe(404);
    expect((await del(`/v1/workspaces/personal/documents/${md.id}`)).statusCode).toBe(404);
    expect((await get(`/v1/workspaces/ouc/documents/${md.id}`, 'stranger')).statusCode).toBe(404);
    expect((await get('/v1/workspaces/ouc/documents', 'stranger')).statusCode).toBe(404);
    expect((await get(`/v1/workspaces/ouc/documents/${md.id}`)).statusCode).toBe(200);
  });

  it('when Chroma is down, delete fails and keeps the row and the file', async () => {
    const md = (await get('/v1/workspaces/ouc/documents?type=md')).json().data[0];
    chromaDown = true;
    try {
      expect((await del(`/v1/workspaces/ouc/documents/${md.id}`)).statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      chromaDown = false;
    }
    expect((await get(`/v1/workspaces/ouc/documents/${md.id}`)).statusCode).toBe(200);
    expect(await readdir(path.join(root, 'ouc'))).toContain(`${md.id}.md`);
  });

  it('deleting the workspace removes its uploads folder', async () => {
    expect((await del('/v1/workspaces/ouc')).statusCode).toBe(204);
    expect(await readdir(root)).not.toContain('ouc');
  });
});
