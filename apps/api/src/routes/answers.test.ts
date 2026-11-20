import { answers, documents, newId, workspaces } from '@rag/db';
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

const output = (outputs: Record<string, string>, usage?: unknown) =>
  Response.json({
    outputs: [
      {
        outputs: Object.entries(outputs).map(([component_id, text]) => ({
          component_id,
          results: { message: { text, properties: { usage } } },
        })),
      },
    ],
  });
const fenced = (v: unknown) => '```json\n' + JSON.stringify(v) + '\n```';

describe.skipIf(!url)('answers (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  let docId = '';
  const auth = { admin: '', reader: '', other: '' };
  const runs: Run[] = [];
  let hits: unknown[] = [];
  let answerReply: () => Response;

  const langflowFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const flow = /\/run\/([^?]+)/.exec(String(input))![1]!;
    runs.push({ flow, body: JSON.parse(String(init?.body)) });
    if (flow === 'rw-retrieve') return output({ 'ChatOutput-passages': fenced({ passages: hits }) });
    return answerReply();
  }) as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    auth.other = `Bearer ${await kc.token({ sub: 'reader-2' })}`;
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DEFAULT_CHAT_PROVIDER: 'lmstudio',
        DEFAULT_CHAT_MODEL: 'qwen-test',
        DEFAULT_TOP_K: '4',
      }),
      db: t.db,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, (async () =>
        Response.json({ id: 'cid' })) as typeof fetch),
      langflow: new LangflowClient({ baseUrl: 'http://lf', apiKey: 'sk', fetch: langflowFetch }),
      logger: false,
      authenticators: [apiKeyAuthenticator(t.db), keycloakAuthenticator(kc.options)],
    });
    const h = { authorization: auth.admin };
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: h,
      payload: { slug: 'ouc', name: 'OUC' },
    });
    for (const id of ['reader-1', 'reader-2']) {
      await app.inject({
        method: 'PUT',
        url: `/v1/workspaces/ouc/members/${id}`,
        headers: h,
        payload: { role: 'reader' },
      });
    }
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    docId = newId('document');
    await t.db.insert(documents).values({
      id: docId,
      workspaceId: ws!.id,
      title: 'Week 3 slides',
      fileName: 'week3.pdf',
      type: 'pdf',
      sizeBytes: 10,
      sha256: 'b'.repeat(64),
      storagePath: `ouc/${docId}.pdf`,
      status: 'ready',
      passageCount: 2,
    });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  beforeEach(() => {
    runs.length = 0;
    const passage = {
      rank: 1,
      id: `${docId}:4`,
      text: 'RAG retrieves relevant passages '.repeat(20),
      score: 0.83,
      document_id: docId,
      page: 12,
      chunk_index: 4,
    };
    hits = [passage];
    answerReply = () =>
      output(
        {
          'ChatOutput-answer': 'RAG combines retrieval with generation [1].',
          'ChatOutput-citations': fenced({ passages: [passage] }),
        },
        { input_tokens: 1840, output_tokens: 212 },
      );
  });

  const ask = (payload: unknown, who: keyof typeof auth = 'reader') =>
    app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/answers',
      headers: { authorization: auth[who] },
      payload: payload as object,
    });

  it('answers with citations, usage and the workspace chat model, and stores it', async () => {
    const res = await ask({ question: 'What is RAG?' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      workspace: 'ouc',
      question: 'What is RAG?',
      text: 'RAG combines retrieval with generation [1].',
      status: 'complete',
      grounded: true,
      provider: 'lmstudio',
      model: 'qwen-test',
      usage: { promptTokens: 1840, completionTokens: 212 },
      timeToFirstTokenMs: null,
      error: null,
      feedback: null,
    });
    expect(body.id).toMatch(/^ans_/);
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]).toMatchObject({
      rank: 1,
      passageId: `psg_${docId.slice(4)}_4`,
      documentId: docId,
      documentTitle: 'Week 3 slides',
      page: 12,
      score: 0.83,
    });
    expect(body.citations[0].snippet.length).toBeLessThanOrEqual(241);

    expect(runs.map((r) => r.flow)).toEqual(['rw-retrieve', 'rw-answer']);
    const llm = runs[1]!.body.tweaks.LLM!;
    expect(llm).toMatchObject({ provider: 'lmstudio', model_name: 'qwen-test', stream: false });
    expect(String(llm.system_message)).toContain('[n]');
    expect(runs[1]!.body.tweaks.Search).toMatchObject({ collection_name: 'ws_ouc', top_k: 4 });

    const [stored] = await t.db.select().from(answers).where(eq(answers.id, body.id));
    expect(stored).toMatchObject({
      askedByKind: 'user',
      askedBy: 'reader-1',
      requestId: res.headers['x-request-id'],
    });
  });

  it('nothing relevant: an ungrounded answer with the fixed text, and no model call', async () => {
    hits = [];
    const res = await ask({ question: 'What is the capital of Peru?' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      grounded: false,
      text: NOT_FOUND_TEXT,
      citations: [],
      provider: null,
    });
    expect(runs.map((r) => r.flow)).toEqual(['rw-retrieve']);
  });

  it('maxPassages sets how many passages the model gets', async () => {
    await ask({ question: 'x', maxPassages: 2 });
    expect(runs[1]!.body.tweaks.Search).toMatchObject({ top_k: 2 });
  });

  it('a failed generation is a 502 and is still stored as failed', async () => {
    answerReply = () => Response.json({ detail: { message: 'model qwen-test not loaded' } }, { status: 500 });
    const res = await ask({ question: 'Will this fail?' });
    expect(res.statusCode).toBe(502);
    expect(res.json().detail).toContain('not loaded');
    const [stored] = await t.db.select().from(answers).where(eq(answers.question, 'Will this fail?'));
    expect(stored).toMatchObject({ status: 'failed', text: null, model: 'qwen-test' });
    expect(stored!.error).toContain('not loaded');
  });

  it('a missing provider key is a 503', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/v1/workspaces/ouc',
      headers: { authorization: auth.admin },
      payload: { settings: { chatProvider: 'anthropic', chatModel: 'claude' } },
    });
    try {
      const res = await ask({ question: 'x' });
      expect(res.statusCode).toBe(503);
      expect(res.json().detail).toContain('ANTHROPIC_API_KEY');
      expect(runs).toHaveLength(0);
    } finally {
      await app.inject({
        method: 'PATCH',
        url: '/v1/workspaces/ouc',
        headers: { authorization: auth.admin },
        payload: { settings: { chatProvider: null, chatModel: null } },
      });
    }
  });

  it('only the asker and admins can read or rate an answer', async () => {
    const id = (await ask({ question: 'mine' })).json().id;
    const get = (who: keyof typeof auth) =>
      app.inject({ url: `/v1/workspaces/ouc/answers/${id}`, headers: { authorization: auth[who] } });
    expect((await get('reader')).statusCode).toBe(200);
    expect((await get('admin')).statusCode).toBe(200);
    expect((await get('other')).statusCode).toBe(404);
  });

  it('feedback is stored, and rating again replaces it', async () => {
    const id = (await ask({ question: 'rate me' })).json().id;
    const rate = (payload: object) =>
      app.inject({
        method: 'POST',
        url: `/v1/workspaces/ouc/answers/${id}/feedback`,
        headers: { authorization: auth.reader },
        payload,
      });
    const down = await rate({ rating: 'down', comment: 'missed week 4' });
    expect(down.statusCode).toBe(200);
    expect(down.json().feedback).toMatchObject({ rating: 'down', comment: 'missed week 4' });
    const up = await rate({ rating: 'up' });
    expect(up.json().feedback).toMatchObject({ rating: 'up', comment: null });
    expect((await rate({ rating: 'meh' })).statusCode).toBe(400);
  });

  it('400 for an empty question', async () => {
    expect((await ask({ question: '   ' })).statusCode).toBe(400);
  });
});
