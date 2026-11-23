import { apiRequests, documents, newId, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { LangflowClient } from '@rag/langflow-client';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { testKeycloak } from '../test/tokens.js';
import { UsageLog } from './log.js';

const url = process.env.TEST_DATABASE_URL;
const fenced = (v: unknown) => '```json\n' + JSON.stringify(v) + '\n```';
const outputBody = (outputs: Record<string, string>) => ({
  outputs: [
    {
      outputs: Object.entries(outputs).map(([component_id, text]) => ({
        component_id,
        results: { message: { text, properties: { usage: { input_tokens: 100, output_tokens: 20 } } } },
      })),
    },
  ],
});

describe.skipIf(!url)('usage log (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  let usage: UsageLog;
  let docId = '';
  let workspaceId = '';
  const auth = { admin: '', reader: '' };

  const passage = () => ({
    rank: 1,
    id: `${docId}:0`,
    text: 'text',
    score: 0.9,
    document_id: docId,
    page: 1,
    chunk_index: 0,
  });
  const langflowFetch = (async (input: string | URL | Request) => {
    const u = String(input);
    if (u.includes('rw-retrieve')) {
      return Response.json(outputBody({ 'ChatOutput-passages': fenced({ passages: [passage()] }) }));
    }
    const result = outputBody({
      'ChatOutput-answer': 'An answer [1].',
      'ChatOutput-citations': fenced({ passages: [passage()] }),
    });
    if (u.includes('stream=true')) {
      return new Response(
        [
          { event: 'token', data: { chunk: 'An answer [1].' } },
          { event: 'end', data: { result } },
        ]
          .map((e) => JSON.stringify(e) + '\n\n')
          .join(''),
      );
    }
    return Response.json(result);
  }) as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    usage = new UsageLog(t.db);
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', DEFAULT_CHAT_MODEL: 'qwen-test' }),
      db: t.db,
      usage,
      chroma: new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, (async () =>
        Response.json({ id: 'cid' })) as typeof fetch),
      langflow: new LangflowClient({ baseUrl: 'http://lf', apiKey: 'sk', fetch: langflowFetch }),
      logger: false,
      authenticators: [keycloakAuthenticator(kc.options)],
    });
    const h = { authorization: auth.admin };
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: h,
      payload: { slug: 'ouc', name: 'OUC' },
    });
    await app.inject({
      method: 'PUT',
      url: '/v1/workspaces/ouc/members/reader-1',
      headers: h,
      payload: { role: 'reader' },
    });
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    workspaceId = ws!.id;
    docId = newId('document');
    await t.db.insert(documents).values({
      id: docId,
      workspaceId,
      title: 'Doc',
      fileName: 'doc.md',
      type: 'md',
      sizeBytes: 1,
      sha256: 'd'.repeat(64),
      storagePath: `ouc/${docId}.md`,
      status: 'ready',
      passageCount: 1,
    });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  beforeEach(async () => {
    await usage.flush();
    await t.db.delete(apiRequests);
  });

  async function rows() {
    await usage.flush();
    return t.db.select().from(apiRequests).orderBy(asc(apiRequests.createdAt));
  }

  it('logs each /v1 request with route pattern, status, caller and workspace, but not /health', async () => {
    await app.inject({ url: '/health' });
    const res = await app.inject({
      url: '/v1/workspaces/ouc/documents',
      headers: { authorization: auth.reader },
    });
    await app.inject({ url: '/v1/workspaces/nope/documents', headers: { authorization: auth.reader } });
    await app.inject({ url: '/v1/me' });
    await app.inject({ url: '/v1/no/such/route/secret-token' });
    const all = await rows();
    // Requests in the same millisecond have no fixed order, so check the unmatched one apart.
    expect(all.filter((x) => x.route === '(no route)').map((x) => x.statusCode)).toEqual([404]);
    expect(all.some((x) => x.route.includes('secret-token'))).toBe(false);
    const r = all.filter((x) => x.route !== '(no route)');
    expect(r.map((x) => [x.route, x.statusCode])).toEqual([
      ['/v1/workspaces/:slug/documents', 200],
      ['/v1/workspaces/:slug/documents', 404],
      ['/v1/me', 401],
    ]);
    expect(r[0]).toMatchObject({
      method: 'GET',
      requestId: res.headers['x-request-id'],
      workspaceSlug: 'ouc',
      workspaceId,
      callerKind: 'user',
      callerId: 'reader-1',
      question: null,
    });
    expect(r[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r[1]).toMatchObject({ workspaceSlug: 'nope', workspaceId: null });
    expect(r[2]).toMatchObject({ callerKind: null, callerId: null });
  });

  it('an answer adds the question, model, tokens and cited documents', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/answers',
      headers: { authorization: auth.reader },
      payload: { question: 'What is RAG?' },
    });
    const [row] = await rows();
    expect(row).toMatchObject({
      route: '/v1/workspaces/:slug/answers',
      statusCode: 201,
      question: 'What is RAG?',
      answerId: res.json().id,
      model: 'qwen-test',
      grounded: true,
      promptTokens: 100,
      completionTokens: 20,
      citedDocumentIds: [docId],
    });
  });

  it('a streamed answer is logged when the stream ends, with time to first token', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/answers',
      headers: { authorization: auth.reader, accept: 'text/event-stream' },
      payload: { question: 'Stream it' },
    });
    const [row] = await rows();
    expect(row).toMatchObject({ statusCode: 200, question: 'Stream it', grounded: true });
    expect(row!.timeToFirstTokenMs).toEqual(expect.any(Number));
  });

  it('chat messages and passage searches are logged with their text', async () => {
    const c = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/conversations',
      headers: { authorization: auth.reader },
      payload: {},
    });
    const m = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/ouc/conversations/${c.json().id}/messages`,
      headers: { authorization: auth.reader },
      payload: { content: 'hello there' },
    });
    await app.inject({
      url: '/v1/workspaces/ouc/passages?query=rag',
      headers: { authorization: auth.reader },
    });
    const r = await rows();
    expect(r[1]).toMatchObject({ question: 'hello there', messageId: m.json().id });
    expect(r[2]).toMatchObject({ route: '/v1/workspaces/:slug/passages', question: 'rag' });
  });

  it('a caller who hangs up mid-stream is logged as 499', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/v1/workspaces/ouc/documents/events`, {
      headers: { authorization: auth.reader },
      signal: ctrl.signal,
    });
    await res.body!.getReader().read();
    ctrl.abort();
    await expect
      .poll(async () => (await rows()).find((r) => r.route === '/v1/workspaces/:slug/documents/events'), {
        timeout: 5_000,
      })
      .toMatchObject({ statusCode: 499 });
  });

  it('retention clears old question text and keeps the row', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/answers',
      headers: { authorization: auth.reader },
      payload: { question: 'old question' },
    });
    await rows();
    await t.db.update(apiRequests).set({ createdAt: sql`now() - interval '100 days'` });
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/answers',
      headers: { authorization: auth.reader },
      payload: { question: 'new question' },
    });
    await rows();
    expect(await usage.trimQuestions(90)).toBe(1);
    const [old, recent] = await rows();
    expect(old).toMatchObject({ question: null, model: 'qwen-test' });
    expect(recent).toMatchObject({ question: 'new question' });
    expect(await usage.trimQuestions(90)).toBe(0);
  });
});
