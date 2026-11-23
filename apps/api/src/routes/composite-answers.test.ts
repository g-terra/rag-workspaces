import { documents, newId, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { LangflowClient } from '@rag/langflow-client';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { apiKeyAuthenticator } from '../auth/api-keys.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { NOT_FOUND_TEXT } from '../services/answers.js';
import { ChromaService } from '../services/chroma.js';
import { testKeycloak } from '../test/tokens.js';

const url = process.env.TEST_DATABASE_URL;

type Run = { flow: string; body: { input_value: string; tweaks: Record<string, Record<string, unknown>> } };

const output = (outputs: Record<string, string>) =>
  Response.json({
    outputs: [
      {
        outputs: Object.entries(outputs).map(([component_id, text]) => ({
          component_id,
          results: { message: { text } },
        })),
      },
    ],
  });
const fenced = (v: unknown) => '```json\n' + JSON.stringify(v) + '\n```';

describe.skipIf(!url)('composite workspaces answer from their sources (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  const auth = { admin: '', reader: '', key: '' };
  const runs: Run[] = [];
  const docs: Record<string, string> = {};
  /** Hits per collection: what rw-retrieve returns for each source. */
  let hits: Record<string, unknown[]> = {};

  const langflowFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const flow = /\/run\/([^?]+)/.exec(String(input))![1]!;
    const body = JSON.parse(String(init?.body));
    runs.push({ flow, body });
    if (flow === 'rw-retrieve') {
      const collection = body.tweaks.Search.collection_name as string;
      return output({ 'ChatOutput-passages': fenced({ passages: hits[collection] ?? [] }) });
    }
    return output({ 'ChatOutput-answer': 'Both say so [1][2].' });
  }) as typeof fetch;

  const hit = (slug: string, rank: number, score: number) => ({
    rank,
    id: `${docs[slug]}:${rank}`,
    text: `${slug} passage ${rank}`,
    score,
    document_id: docs[slug],
    page: rank,
    chunk_index: rank,
  });

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DEFAULT_CHAT_PROVIDER: 'lmstudio',
        DEFAULT_CHAT_MODEL: 'qwen-test',
        DEFAULT_TOP_K: '4',
        OPENAI_API_KEY: 'sk-test',
        RATE_LIMIT_MODEL_PER_MINUTE: '200',
      }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, (async (
        input: string | URL | Request,
      ) =>
        String(input).endsWith('/get')
          ? Response.json({
              ids: [`${docs.personal}:1`],
              documents: ['personal passage 1'],
              metadatas: [{ document_id: docs.personal, chunk_index: 1 }],
            })
          : Response.json({ id: 'cid' })) as typeof fetch),
      langflow: new LangflowClient({ baseUrl: 'http://lf', apiKey: 'sk', fetch: langflowFetch }),
      logger: false,
      authenticators: [apiKeyAuthenticator(t.db), keycloakAuthenticator(kc.options)],
    });
    const admin = (method: 'POST' | 'PUT' | 'PATCH', path: string, payload: object) =>
      app.inject({ method, url: path, headers: { authorization: auth.admin }, payload });
    await admin('POST', '/v1/workspaces', {
      slug: 'ouc',
      name: 'OUC',
      settings: { embeddingModel: 'nomic', minScore: 0.4 },
    });
    await admin('POST', '/v1/workspaces', {
      slug: 'personal',
      name: 'Personal',
      settings: { embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small' },
    });
    await admin('POST', '/v1/workspaces', { slug: 'other', name: 'Other' });
    const study = await admin('POST', '/v1/workspaces', {
      slug: 'study',
      name: 'Study',
      kind: 'composite',
      sources: ['ouc', 'personal'],
      settings: { chatModel: 'big-model', systemPrompt: 'Composite prompt.', topK: 3 },
    });
    expect(study.statusCode).toBe(201);
    await admin('PUT', '/v1/workspaces/study/members/reader-1', { role: 'reader' });
    const key = await admin('POST', '/v1/api-keys', { name: 'bot', role: 'reader', workspaces: ['study'] });
    auth.key = `Bearer ${key.json().secret}`;

    for (const slug of ['ouc', 'personal', 'other']) {
      const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, slug));
      docs[slug] = newId('document');
      await t.db.insert(documents).values({
        id: docs[slug],
        workspaceId: ws!.id,
        title: `${slug} notes`,
        fileName: `${slug}.pdf`,
        type: 'pdf',
        sizeBytes: 10,
        sha256: slug.padEnd(64, '0'),
        storagePath: `${slug}/${docs[slug]}.pdf`,
        status: 'ready',
        passageCount: 3,
      });
    }
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  beforeEach(() => {
    runs.length = 0;
    hits = {
      ws_ouc: [hit('ouc', 1, 0.5), hit('ouc', 2, 0.45)],
      ws_personal: [hit('personal', 1, 0.9)],
    };
  });

  const ask = (who: keyof typeof auth, question = 'What is RAG?') =>
    app.inject({
      method: 'POST',
      url: '/v1/workspaces/study/answers',
      headers: { authorization: auth[who] },
      payload: { question },
    });

  it('searches each source with its own model and threshold, then answers with the composite settings', async () => {
    const res = await ask('reader');
    expect(res.statusCode).toBe(201);

    const retrieves = runs.filter((r) => r.flow === 'rw-retrieve');
    expect(retrieves.map((r) => r.body.tweaks.Search!.collection_name).sort()).toEqual([
      'ws_ouc',
      'ws_personal',
    ]);
    const ouc = retrieves.find((r) => r.body.tweaks.Search!.collection_name === 'ws_ouc')!;
    expect(ouc.body.tweaks.Embeddings!.model).toBe('nomic');
    expect(ouc.body.tweaks.Search).toMatchObject({ top_k: 3, min_score: 0.4 });

    const generate = runs.find((r) => r.flow === 'rw-generate')!;
    expect(generate.body.input_value).toBe('What is RAG?');
    expect(generate.body.tweaks.LLM).toMatchObject({ model_name: 'big-model' });
    expect(String(generate.body.tweaks.LLM!.system_message)).toContain('Composite prompt.');
    expect(generate.body.tweaks.Prompt!.context).toBe(
      '[1] (Personal: personal notes, page 1)\npersonal passage 1\n\n' +
        '[2] (OUC: ouc notes, page 1)\nouc passage 1\n\n' +
        '[3] (OUC: ouc notes, page 2)\nouc passage 2',
    );
    expect(runs.some((r) => r.flow === 'rw-answer')).toBe(false);

    expect(res.json()).toMatchObject({
      workspace: 'study',
      text: 'Both say so [1][2].',
      grounded: true,
      model: 'big-model',
      citations: [
        { rank: 1, workspace: 'personal', documentId: docs.personal },
        { rank: 2, workspace: 'ouc', documentId: docs.ouc },
        { rank: 3, workspace: 'ouc' },
      ],
    });
  });

  it('nothing found in any source: the fixed reply, and no model call', async () => {
    hits = {};
    const res = await ask('reader');
    expect(res.json()).toMatchObject({ text: NOT_FOUND_TEXT, grounded: false, citations: [] });
    expect(runs.some((r) => r.flow === 'rw-generate')).toBe(false);
  });

  it('a source being reindexed is skipped', async () => {
    await t.db.update(workspaces).set({ status: 'reindexing' }).where(eq(workspaces.slug, 'personal'));
    try {
      const res = await ask('reader');
      expect(res.statusCode).toBe(201);
      expect(res.json().citations.map((c: { workspace: string }) => c.workspace)).toEqual(['ouc', 'ouc']);
      expect(runs.filter((r) => r.flow === 'rw-retrieve')).toHaveLength(1);
    } finally {
      await t.db.update(workspaces).set({ status: 'active' }).where(eq(workspaces.slug, 'personal'));
    }
  });

  it('a key bound to the composite can ask, but cannot reach a source directly', async () => {
    expect((await ask('key')).statusCode).toBe(201);
    const direct = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/answers',
      headers: { authorization: auth.key },
      payload: { question: 'x' },
    });
    expect(direct.statusCode).toBe(404);
  });

  it('a chat message answers from the sources too, with the history in the prompt', async () => {
    const h = { authorization: auth.reader };
    const conv = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/study/conversations',
      headers: h,
      payload: {},
    });
    const id = conv.json().id as string;
    const send = (content: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/workspaces/study/conversations/${id}/messages`,
        headers: h,
        payload: { content },
      });
    expect((await send('What is RAG?')).statusCode).toBe(201);
    runs.length = 0;
    const second = await send('And chunking?');
    expect(second.statusCode).toBe(201);
    expect(second.json().citations[0]).toMatchObject({ workspace: 'personal' });
    const generate = runs.find((r) => r.flow === 'rw-generate')!;
    expect(generate.body.input_value).toBe('And chunking?');
    expect(String(generate.body.tweaks.Prompt!.history)).toContain('User: What is RAG?');
  });

  it('passage search fuses the sources and says where each passage is from', async () => {
    const res = await app.inject({
      url: '/v1/workspaces/study/passages?query=rag',
      headers: { authorization: auth.reader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((p: { workspace: string }) => p.workspace)).toEqual([
      'personal',
      'ouc',
      'ouc',
    ]);
  });

  it('a cited passage can be previewed through the composite, but not one from outside its sources', async () => {
    const get = (doc: string) =>
      app.inject({
        url: `/v1/workspaces/study/passages/psg_${doc.replace(/^doc_/, '')}_1`,
        headers: { authorization: auth.reader },
      });
    const res = await get(docs.personal!);
    expect(res.statusCode).toBe(200);
    expect(res.json().passage).toMatchObject({ documentId: docs.personal, workspace: 'personal' });
    expect((await get(docs.other!)).statusCode).toBe(404);
  });
});
