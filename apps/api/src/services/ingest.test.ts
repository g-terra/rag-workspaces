import { documents, folders, newId, workspaces, type Database } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { LangflowClient } from '@rag/langflow-client';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { ChromaService } from './chroma.js';
import { DocumentEvents } from './document-events.js';
import { IngestProcessor, PgBossIngestQueue } from './ingest.js';

const url = process.env.TEST_DATABASE_URL;
const log = pino({ level: 'silent' });

type Behaviour = 'ok' | 'fail' | 'hang';

/** Fakes for Langflow and Chroma that record what they were asked, in order. */
function fakes() {
  const calls: string[] = [];
  const runs: { tweaks: Record<string, Record<string, unknown>> }[] = [];
  let behaviour: Behaviour = 'ok';
  let duringRun: (() => Promise<unknown>) | undefined;
  const langflowFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push('langflow run');
    runs.push(JSON.parse(String(init?.body)));
    await duringRun?.();
    if (behaviour === 'fail') {
      return new Response(JSON.stringify({ detail: { message: 'File not found: /data/uploads/x.pdf' } }), {
        status: 500,
      });
    }
    if (behaviour === 'hang') {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
      );
    }
    const text = '```json\n{"collection":"ws_ouc","document_id":"x","chunks":7,"pages":3}\n```';
    return new Response(
      JSON.stringify({
        outputs: [{ outputs: [{ component_id: 'ChatOutput-result', results: { message: { text } } }] }],
      }),
    );
  }) as typeof fetch;
  const chromaFetch = (async (input: string | URL | Request) => {
    calls.push(`chroma ${String(input).endsWith('/delete') ? 'delete vectors' : 'lookup'}`);
    return new Response(JSON.stringify({ id: 'cid' }));
  }) as typeof fetch;
  return {
    calls,
    runs,
    set: (b: Behaviour) => (behaviour = b),
    during: (fn?: () => Promise<unknown>) => (duringRun = fn),
    langflow: new LangflowClient({ baseUrl: 'http://lf', apiKey: 'sk', fetch: langflowFetch }),
    chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, chromaFetch),
  };
}

describe.skipIf(!url)('ingestion (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: Database;
  let workspaceId: string;
  const f = fakes();
  const events = new DocumentEvents();
  const seen: string[] = [];
  events.subscribe((e) => seen.push(e.document.status));
  const config = loadConfig({
    NODE_ENV: 'test',
    INGEST_TIMEOUT_MS: '300',
    INGEST_TIMEOUT_MS_PER_MB: '0',
    INGEST_MAX_ATTEMPTS: '2',
  });
  const processor = () =>
    new IngestProcessor({ db, langflow: f.langflow, chroma: f.chroma, events, config, log });

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    db = t.db;
    workspaceId = newId('workspace');
    await db.insert(workspaces).values({
      id: workspaceId,
      slug: 'ouc',
      name: 'OUC',
      settings: { embeddingProvider: 'lmstudio', embeddingModel: 'nomic', chunkSize: 500 },
    });
  });
  afterAll(() => t.drop());
  beforeEach(() => {
    f.calls.length = 0;
    f.runs.length = 0;
    f.set('ok');
    f.during(undefined);
    seen.length = 0;
  });

  async function newDocument() {
    const id = newId('document');
    await db.insert(documents).values({
      id,
      workspaceId,
      title: 'notes',
      fileName: 'notes.pdf',
      type: 'pdf',
      sizeBytes: 1000,
      sha256: id,
      storagePath: `ouc/${id}.pdf`,
    });
    return id;
  }
  const get = async (id: string) => (await db.select().from(documents).where(eq(documents.id, id)))[0]!;

  it('runs the flow with the workspace settings and marks the document ready', async () => {
    const id = await newDocument();
    expect(await processor().process(id)).toBe('ready');
    expect(await get(id)).toMatchObject({ status: 'ready', passageCount: 7, attempts: 1, error: null });
    expect(seen).toEqual(['processing', 'ready']);
    expect(f.runs[0]!.tweaks).toEqual({
      Loader: { file_path: `ouc/${id}.pdf`, document_id: id, filename: 'notes.pdf', folder: '' },
      Split: { chunk_size: 500, chunk_overlap: 100 },
      Embeddings: { model: 'nomic', base_url: 'http://host.docker.internal:1234/v1', api_key: 'lm-studio' },
      Upsert: { collection_name: 'ws_ouc', document_id: id },
    });
  });

  it("passes the document's folder to the loader, so its passages carry it", async () => {
    const id = await newDocument();
    const folderId = newId('folder');
    await db.insert(folders).values({ id: folderId, workspaceId, name: 'COS512' });
    await db.update(documents).set({ folderId }).where(eq(documents.id, id));
    await processor().process(id);
    expect(f.runs[0]!.tweaks.Loader).toMatchObject({ folder: folderId });
  });

  it("starts clean: the document's vectors are deleted before the flow runs", async () => {
    await processor().process(await newDocument());
    expect(f.calls).toEqual(['chroma lookup', 'chroma delete vectors', 'langflow run']);
  });

  it("a failure goes back to queued with Langflow's reason, and the last attempt fails for good", async () => {
    f.set('fail');
    const id = await newDocument();
    expect(await processor().process(id)).toBe('retry');
    expect(await get(id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      error: 'File not found: /data/uploads/x.pdf',
    });
    expect(await processor().process(id)).toBe('failed');
    expect(await get(id)).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('a failed run deletes the vectors it may have written', async () => {
    f.set('fail');
    await processor().process(await newDocument());
    expect(f.calls.slice(-3)).toEqual(['langflow run', 'chroma lookup', 'chroma delete vectors']);
  });

  it('a document deleted during its run has its new vectors removed', async () => {
    const id = await newDocument();
    f.during(() => db.delete(documents).where(eq(documents.id, id)));
    expect(await processor().process(id)).toBe('gone');
    expect(f.calls.slice(-3)).toEqual(['langflow run', 'chroma lookup', 'chroma delete vectors']);
  });

  it('a run that takes too long is stopped and reported in words', async () => {
    f.set('hang');
    const id = await newDocument();
    await processor().process(id);
    expect((await get(id)).error).toMatch(/took longer than 0 s/);
  });

  it('a workspace on a provider without a key fails with the reason', async () => {
    const ws = newId('workspace');
    await db.insert(workspaces).values({
      id: ws,
      slug: 'hosted',
      name: 'Hosted',
      settings: { embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small' },
    });
    const id = newId('document');
    await db.insert(documents).values({
      id,
      workspaceId: ws,
      title: 'a',
      fileName: 'a.md',
      type: 'md',
      sizeBytes: 1,
      sha256: 'a',
      storagePath: `hosted/${id}.md`,
    });
    await processor().process(id);
    expect((await get(id)).error).toBe('OPENAI_API_KEY is not set');
    expect(f.runs).toHaveLength(0);
  });

  it('a document deleted while queued is skipped', async () => {
    expect(await processor().process('doc_gone')).toBe('gone');
  });

  it('recovery puts documents left mid-run back in the queue', async () => {
    const id = await newDocument();
    await db.update(documents).set({ status: 'processing' }).where(eq(documents.id, id));
    const queued = await processor().recover();
    expect(queued).toContain(id);
    expect((await get(id)).status).toBe('queued');
    expect(seen).toContain('queued');
  });

  describe('during a workspace reindex', () => {
    async function reindexingWorkspace(docs: number) {
      const ws = newId('workspace');
      await db.insert(workspaces).values({
        id: ws,
        slug: ws.toLowerCase().replace(/[^a-z0-9]/g, ''),
        name: 'Reindexing',
        status: 'reindexing',
        settings: { embeddingProvider: 'lmstudio', embeddingModel: 'nomic' },
      });
      const ids: string[] = [];
      for (let i = 0; i < docs; i++) {
        const id = newId('document');
        await db.insert(documents).values({
          id,
          workspaceId: ws,
          title: 'a',
          fileName: 'a.md',
          type: 'md',
          sizeBytes: 1,
          sha256: id,
          storagePath: `x/${id}.md`,
        });
        ids.push(id);
      }
      const status = async () => (await db.select().from(workspaces).where(eq(workspaces.id, ws)))[0]!.status;
      return { ids, status };
    }

    it('a run the reindex sent back to the queue leaves the row alone', async () => {
      const { ids, status } = await reindexingWorkspace(1);
      const id = ids[0]!;
      f.during(() => db.update(documents).set({ status: 'queued', attempts: 0 }).where(eq(documents.id, id)));
      expect(await processor().process(id)).toBe('gone');
      expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0, passageCount: null });
      expect(f.calls.slice(-2)).toEqual(['chroma lookup', 'chroma delete vectors']);
      expect(await status()).toBe('reindexing');
    });

    it('a superseded run that fails does not fail the requeued document', async () => {
      const { ids } = await reindexingWorkspace(1);
      const id = ids[0]!;
      f.set('fail');
      f.during(() => db.update(documents).set({ status: 'queued', attempts: 0 }).where(eq(documents.id, id)));
      expect(await processor().process(id)).toBe('gone');
      expect(await get(id)).toMatchObject({ status: 'queued', attempts: 0, error: null });
    });

    it('the workspace is active again once its last document finishes', async () => {
      const { ids, status } = await reindexingWorkspace(2);
      expect(await processor().process(ids[0]!)).toBe('ready');
      expect(await status()).toBe('reindexing');
      f.set('fail');
      // INGEST_MAX_ATTEMPTS is 2: a retry keeps it pending, the second failure ends it.
      expect(await processor().process(ids[1]!)).toBe('retry');
      expect(await status()).toBe('reindexing');
      expect(await processor().process(ids[1]!)).toBe('failed');
      expect(await status()).toBe('active');
    });

    it('recovery closes a reindex whose documents all finished', async () => {
      const { ids, status } = await reindexingWorkspace(1);
      await db.update(documents).set({ status: 'ready' }).where(eq(documents.id, ids[0]!));
      await processor().recover();
      expect(await status()).toBe('active');
    });
  });

  it('the pg-boss queue processes an enqueued document, retrying until it fails for good', async () => {
    const queue = new PgBossIngestQueue(t.url, processor(), log, {
      maxAttempts: 2,
      retryDelaySeconds: 1,
      pollingIntervalSeconds: 0.5,
    });
    await queue.start();
    await queue.startWorking();
    try {
      const ok = await newDocument();
      await queue.enqueue(ok);
      await expect.poll(async () => (await get(ok)).status, { timeout: 10_000, interval: 200 }).toBe('ready');

      f.set('fail');
      const bad = await newDocument();
      await queue.enqueue(bad);
      await expect
        .poll(async () => (await get(bad)).status, { timeout: 15_000, interval: 200 })
        .toBe('failed');
      expect((await get(bad)).attempts).toBe(2);
    } finally {
      await queue.stop();
    }
  }, 30_000);
});
