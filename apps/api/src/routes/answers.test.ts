import { answers, documents, folders, newId, providerKeys, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { LangflowClient } from '@rag/langflow-client';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../app.js';
import { apiKeyAuthenticator } from '../auth/api-keys.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { AnswerService, DEFAULT_SYSTEM_PROMPT, NOT_FOUND_TEXT } from '../services/answers.js';
import { ChromaService } from '../services/chroma.js';
import { sealSecret } from '../services/secrets.js';
import { testKeycloak } from '../test/tokens.js';

const url = process.env.TEST_DATABASE_URL;

type Run = { flow: string; body: { input_value: string; tweaks: Record<string, Record<string, unknown>> } };

const output = (outputs: Record<string, string>, usage?: unknown) =>
  Response.json(outputBody(outputs, usage));
const outputBody = (outputs: Record<string, string>, usage?: unknown) => ({
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
  let kc: Awaited<ReturnType<typeof testKeycloak>>;
  let streamEvents: () => unknown[];
  /** When set, the streamed run sends one token and then waits until it is aborted. */
  let hangAfterFirstToken = false;

  const langflowFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const flow = /\/run\/([^?]+)/.exec(String(input))![1]!;
    runs.push({ flow, body: JSON.parse(String(init?.body)) });
    if (flow === 'rw-retrieve') return output({ 'ChatOutput-passages': fenced({ passages: hits }) });
    if (String(input).includes('stream=true') && hangAfterFirstToken) {
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(JSON.stringify({ event: 'token', data: { chunk: 'RAG ' } }) + '\n\n'),
            );
            signal?.addEventListener('abort', () => c.error(signal.reason));
          },
        }),
      );
    }
    if (String(input).includes('stream=true')) {
      return new Response(
        streamEvents()
          .map((e) => JSON.stringify(e) + '\n\n')
          .join(''),
      );
    }
    return answerReply();
  }) as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    auth.other = `Bearer ${await kc.token({ sub: 'reader-2' })}`;
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DEFAULT_CHAT_PROVIDER: 'lmstudio',
        DEFAULT_CHAT_MODEL: 'qwen-test',
        SECRETS_KEY: 'answers-test-secrets-key',
        DEFAULT_TOP_K: '4',
        // More model calls than one minute's default limit (30) happen in this file.
        RATE_LIMIT_MODEL_PER_MINUTE: '200',
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
    hangAfterFirstToken = false;
    streamEvents = () => [
      { event: 'add_message', data: {} },
      { event: 'token', data: { chunk: 'RAG combines ' } },
      { event: 'token', data: { chunk: '' } },
      { event: 'token', data: { chunk: 'retrieval [1].' } },
      { event: 'end', data: { result: JSON.parse(JSON.stringify(answerBody())) } },
    ];
    answerReply = () => Response.json(answerBody());
    const answerBody = () =>
      outputBody(
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
      sourceUrl: null,
      page: 12,
      startSeconds: null,
      score: 0.83,
    });
    expect(body.citations[0].snippet.length).toBeLessThanOrEqual(241);

    expect(runs.map((r) => r.flow)).toEqual(['rw-retrieve', 'rw-answer']);
    const llm = runs[1]!.body.tweaks.LLM!;
    // No reasoning effort set anywhere: nothing is sent, so the model does what it does by default.
    expect(llm).toMatchObject({
      provider: 'lmstudio',
      model_name: 'qwen-test',
      stream: false,
      reasoning_effort: '',
    });
    expect(String(llm.system_message)).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(runs[1]!.body.tweaks.Search).toMatchObject({ collection_name: 'ws_ouc', top_k: 4 });

    const [stored] = await t.db.select().from(answers).where(eq(answers.id, body.id));
    expect(stored).toMatchObject({
      askedByKind: 'user',
      askedBy: 'reader-1',
      requestId: res.headers['x-request-id'],
    });
  });

  it("embeds the question and answers with the workspace's own saved keys", async () => {
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    const before = ws!.settings;
    const seal = (provider: string, key: string) => ({
      workspaceId: ws!.id,
      provider,
      sealed: sealSecret('answers-test-secrets-key', key, `${ws!.id}:${provider}`),
      last4: key.slice(-4),
      savedBy: 'admin-1',
    });
    await t.db
      .insert(providerKeys)
      .values([seal('gemini', 'gemini-ws-key'), seal('openai', 'openai-ws-key')]);
    await t.db
      .update(workspaces)
      .set({
        settings: {
          ...before,
          embeddingProvider: 'gemini',
          embeddingModel: 'gemini-embedding-001',
          chatProvider: 'openai',
          chatModel: 'gpt-test',
        },
      })
      .where(eq(workspaces.id, ws!.id));
    try {
      expect((await ask({ question: 'What is RAG?' })).statusCode).toBe(201);
      for (const run of runs) expect(run.body.tweaks.Embeddings).toMatchObject({ api_key: 'gemini-ws-key' });
      expect(runs.find((r) => r.flow === 'rw-answer')!.body.tweaks.LLM).toMatchObject({
        provider: 'openai',
        api_key: 'openai-ws-key',
      });
    } finally {
      await t.db.delete(providerKeys).where(eq(providerKeys.workspaceId, ws!.id));
      await t.db.update(workspaces).set({ settings: before }).where(eq(workspaces.id, ws!.id));
    }
  });

  it("sends the workspace's reasoning effort to the chat model", async () => {
    const set = (reasoningEffort: string | null) =>
      app.inject({
        method: 'PATCH',
        url: '/v1/workspaces/ouc',
        headers: { authorization: auth.admin },
        payload: { settings: { reasoningEffort } },
      });
    expect((await set('none')).json().settings.reasoningEffort).toBe('none');
    try {
      await ask({ question: 'What is RAG?' });
      expect(runs.find((r) => r.flow === 'rw-answer')!.body.tweaks.LLM).toMatchObject({
        reasoning_effort: 'none',
      });
    } finally {
      await set(null);
    }
  });

  describe('response styles', () => {
    const setDefault = (style: string | null) =>
      app.inject({
        method: 'PATCH',
        url: '/v1/workspaces/ouc',
        headers: { authorization: auth.admin },
        payload: { settings: { style } },
      });
    const systemMessage = () =>
      String(runs.find((r) => r.flow === 'rw-answer')!.body.tweaks.LLM!.system_message);

    it('no style: the answer records none and the prompt is unchanged', async () => {
      const res = await ask({ question: 'What is RAG?' });
      expect(res.json().style).toBeNull();
      expect(systemMessage()).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    it("a request's style is added after the system prompt, and stored with the answer", async () => {
      const res = await ask({ question: 'What is RAG?', style: 'academic' });
      expect(res.statusCode).toBe(201);
      expect(res.json().style).toBe('academic');
      expect(systemMessage().startsWith(`${DEFAULT_SYSTEM_PROMPT}\n\nResponse style: Academic.`)).toBe(true);
      expect(systemMessage()).toContain('cite them with [n]');
      const [stored] = await t.db.select().from(answers).where(eq(answers.id, res.json().id));
      expect(stored!.style).toBe('academic');
      const read = await app.inject({
        method: 'GET',
        url: `/v1/workspaces/ouc/answers/${res.json().id}`,
        headers: { authorization: auth.reader },
      });
      expect(read.json().style).toBe('academic');
    });

    it("the workspace's default style applies, and a request's own style wins over it", async () => {
      expect((await setDefault('tutor')).json().settings.style).toBe('tutor');
      try {
        expect((await ask({ question: 'What is RAG?' })).json().style).toBe('tutor');
        expect(systemMessage()).toContain('Response style: Tutor.');
        runs.length = 0;
        expect((await ask({ question: 'What is RAG?', style: 'concise' })).json().style).toBe('concise');
        expect(systemMessage()).toContain('Response style: Concise.');
        runs.length = 0;
        // `null` asks for no style, even where the workspace has a default.
        expect((await ask({ question: 'What is RAG?', style: null })).json().style).toBeNull();
        expect(systemMessage()).toBe(DEFAULT_SYSTEM_PROMPT);
      } finally {
        await setDefault(null);
      }
    });

    it("a workspace's own system prompt keeps its place, with the style after it", async () => {
      const patch = (systemPrompt: string | null) =>
        app.inject({
          method: 'PATCH',
          url: '/v1/workspaces/ouc',
          headers: { authorization: auth.admin },
          payload: { settings: { systemPrompt } },
        });
      await patch('Only answer about week 3.');
      try {
        await ask({ question: 'What is RAG?', style: 'talkative' });
        expect(systemMessage().startsWith('Only answer about week 3.\n\nResponse style: Talkative.')).toBe(
          true,
        );
        // The default prompt's rules are not added to a prompt that may not want them.
        expect(systemMessage()).not.toContain('cite them with [n]');
      } finally {
        await patch(null);
      }
    });

    it('an unknown style is a 400 and nothing is asked or stored', async () => {
      const before = (await t.db.select().from(answers)).length;
      const res = await ask({ question: 'What is RAG?', style: 'pirate' });
      expect(res.statusCode).toBe(400);
      expect(res.json().detail).toContain('pirate');
      expect(runs).toHaveLength(0);
      expect(await t.db.select().from(answers)).toHaveLength(before);
    });

    it('nothing relevant: the fixed text whatever the style, and the style is still recorded', async () => {
      hits = [];
      const res = await ask({ question: 'What is the capital of Peru?', style: 'talkative' });
      expect(res.json()).toMatchObject({ grounded: false, text: NOT_FOUND_TEXT, style: 'talkative' });
    });

    it('a workspace default that no longer exists is ignored, not blamed on the caller', async () => {
      const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
      const before = ws!.settings;
      await t.db
        .update(workspaces)
        .set({ settings: { ...before, style: 'gone' } })
        .where(eq(workspaces.id, ws!.id));
      try {
        const res = await ask({ question: 'What is RAG?' });
        expect(res.statusCode).toBe(201);
        expect(res.json().style).toBeNull();
        expect(systemMessage()).toBe(DEFAULT_SYSTEM_PROMPT);
      } finally {
        await t.db.update(workspaces).set({ settings: before }).where(eq(workspaces.id, ws!.id));
      }
    });

    it('a streamed answer carries its style in done; an unknown style is a plain 400 before any stream', async () => {
      const streamed = await app.inject({
        method: 'POST',
        url: '/v1/workspaces/ouc/answers',
        headers: { authorization: auth.reader, accept: 'text/event-stream' },
        payload: { question: 'What is RAG?', style: 'concise' },
      });
      expect(streamed.body).toMatch(/event: done\ndata: .*"style":"concise"/);
      const bad = await app.inject({
        method: 'POST',
        url: '/v1/workspaces/ouc/answers',
        headers: { authorization: auth.reader, accept: 'text/event-stream' },
        payload: { question: 'What is RAG?', style: 'no-such-style' },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.headers['content-type']).toContain('application/problem+json');
    });

    it('a failed answer still records its style', async () => {
      answerReply = () => Response.json({ detail: { message: 'model not loaded' } }, { status: 500 });
      const res = await ask({ question: 'Will this styled one fail?', style: 'concise' });
      expect(res.statusCode).toBe(502);
      const [stored] = await t.db
        .select()
        .from(answers)
        .where(eq(answers.question, 'Will this styled one fail?'));
      expect(stored).toMatchObject({ status: 'failed', style: 'concise' });
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

  it('a reply that cites none of its passages is ungrounded, but keeps its text and the passages it saw', async () => {
    const reply = 'The material does not cover the capital of Peru.';
    answerReply = () =>
      Response.json(
        outputBody({
          'ChatOutput-answer': reply,
          'ChatOutput-citations': fenced({ passages: hits }),
        }),
      );
    const res = await ask({ question: 'What is the capital of Peru?' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ grounded: false, text: reply, provider: 'lmstudio' });
    expect(res.json().citations).toHaveLength(1);
    const [stored] = await t.db.select().from(answers).where(eq(answers.id, res.json().id));
    expect(stored).toMatchObject({ grounded: false });
  });

  it('a citation in the fullwidth style some models write counts; a number past the passages does not', async () => {
    const replyWith = (text: string) => () =>
      Response.json(
        outputBody({ 'ChatOutput-answer': text, 'ChatOutput-citations': fenced({ passages: hits }) }),
      );
    answerReply = replyWith('RAG retrieves first 【1†L3-L5】.');
    expect((await ask({ question: 'What is RAG?' })).json()).toMatchObject({ grounded: true });
    answerReply = replyWith('RAG retrieves first [7].');
    expect((await ask({ question: 'What is RAG?' })).json()).toMatchObject({ grounded: false });
  });

  /** A folder in `ouc`, made straight in the database. */
  async function oucFolder() {
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    const id = newId('folder');
    await t.db.insert(folders).values({ id, workspaceId: ws!.id, name: id });
    return id;
  }

  it('folderId limits both searches to that folder; a folder from elsewhere is 404', async () => {
    const folderId = await oucFolder();
    expect((await ask({ question: 'x', folderId })).statusCode).toBe(201);
    expect(runs.map((r) => r.body.tweaks.Search!.folder)).toEqual([folderId, folderId]);
    expect((await ask({ question: 'x', folderId: 'fld_nope' })).statusCode).toBe(404);
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

  it('a citation from a transcript carries the second its passage starts at', async () => {
    hits = [{ ...(hits[0] as object), page: null, start_seconds: 754.2 }];
    answerReply = () =>
      output({
        'ChatOutput-answer': 'At this point [1].',
        'ChatOutput-citations': fenced({ passages: hits }),
      });
    const body = (await ask({ question: 'When?' })).json();
    expect(body.citations[0]).toMatchObject({ page: null, startSeconds: 754.2 });
  });

  it('an answer stored before start times existed reads back with startSeconds null', async () => {
    const id = (await ask({ question: 'old one' })).json().id;
    const [row] = await t.db.select().from(answers).where(eq(answers.id, id));
    const old = row!.citations.map(({ startSeconds: _, ...c }) => c);
    await t.db.update(answers).set({ citations: old }).where(eq(answers.id, id));
    const res = await app.inject({
      url: `/v1/workspaces/ouc/answers/${id}`,
      headers: { authorization: auth.reader },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().citations[0]).toMatchObject({ page: 12, startSeconds: null });
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

  it('only the asker can rate: feedback from anyone else is 404 and changes nothing', async () => {
    const id = (await ask({ question: 'not yours to rate' })).json().id;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/ouc/answers/${id}/feedback`,
      headers: { authorization: auth.other },
      payload: { rating: 'down' },
    });
    expect(res.statusCode).toBe(404);
    const [stored] = await t.db.select().from(answers).where(eq(answers.id, id));
    expect(stored!.feedbackRating).toBeNull();
  });

  it("an API key and a person with the same id do not see each other's answers", async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: { authorization: auth.admin },
      payload: { name: 'bot', role: 'reader', workspaces: ['ouc'] },
    });
    const key = created.json();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/answers',
      headers: { authorization: `Bearer ${key.secret}` },
      payload: { question: 'from a key' },
    });
    expect(res.statusCode).toBe(201);
    // A person whose Keycloak id happens to equal the key's id, and a member of the workspace.
    await app.inject({
      method: 'PUT',
      url: `/v1/workspaces/ouc/members/${key.id}`,
      headers: { authorization: auth.admin },
      payload: { role: 'reader' },
    });
    const twin = `Bearer ${await kc.token({ sub: key.id })}`;
    const read = await app.inject({
      url: `/v1/workspaces/ouc/answers/${res.json().id}`,
      headers: { authorization: twin },
    });
    expect(read.statusCode).toBe(404);
  });

  it('an answer is only found through its own workspace', async () => {
    const id = (await ask({ question: 'where am I' })).json().id;
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: { authorization: auth.admin },
      payload: { slug: 'personal', name: 'Personal' },
    });
    const res = await app.inject({
      url: `/v1/workspaces/personal/answers/${id}`,
      headers: { authorization: auth.admin },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a hit whose document is not ready does not count: the answer is ungrounded', async () => {
    await t.db.update(documents).set({ status: 'processing' }).where(eq(documents.id, docId));
    try {
      const res = await ask({ question: 'only stale hits' });
      expect(res.json()).toMatchObject({ grounded: false });
      expect(runs.map((r) => r.flow)).toEqual(['rw-retrieve']);
    } finally {
      await t.db.update(documents).set({ status: 'ready' }).where(eq(documents.id, docId));
    }
  });

  it('an empty reply from the model is a failed answer, not an empty one', async () => {
    answerReply = () =>
      output({ 'ChatOutput-answer': '  ', 'ChatOutput-citations': fenced({ passages: [] }) });
    const res = await ask({ question: 'say nothing' });
    expect(res.statusCode).toBe(502);
    const [stored] = await t.db.select().from(answers).where(eq(answers.question, 'say nothing'));
    expect(stored).toMatchObject({ status: 'failed', error: 'The model returned an empty answer.' });
  });

  it('400 for an empty question', async () => {
    expect((await ask({ question: '   ' })).statusCode).toBe(400);
  });

  /** Parse an event stream body into `[event, data]` pairs. */
  const events = (body: string) =>
    body
      .split('\n\n')
      .filter(Boolean)
      .map((block) => {
        const event = /^event: (.*)$/m.exec(block)![1]!;
        return [event, JSON.parse(/^data: (.*)$/m.exec(block)![1]!)] as const;
      });

  const askStream = (question: string) =>
    app.inject({
      method: 'POST',
      url: '/v1/workspaces/ouc/answers',
      headers: { authorization: auth.reader, accept: 'text/event-stream' },
      payload: { question },
    });

  it('streams tokens, then citations, then the stored answer', async () => {
    const res = await askStream('Stream it');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const ev = events(res.body);
    expect(ev.map(([e]) => e)).toEqual(['token', 'token', 'citations', 'done']);
    expect(ev[0]![1]).toEqual({ text: 'RAG combines ' });
    const done = ev[3]![1] as { id: string; text: string; timeToFirstTokenMs: number | null };
    expect(done.text).toBe('RAG combines retrieval with generation [1].');
    expect(done.timeToFirstTokenMs).toEqual(expect.any(Number));
    expect(runs[1]!.body.tweaks.LLM).toMatchObject({ stream: true });
    const [stored] = await t.db.select().from(answers).where(eq(answers.id, done.id));
    expect(stored!.timeToFirstTokenMs).toEqual(expect.any(Number));
  });

  it('a stream that fails midway ends with an error event, and the answer is stored as failed', async () => {
    streamEvents = () => [
      { event: 'token', data: { chunk: 'RAG ' } },
      { event: 'error', data: { text: 'Connection error.\n' } },
      { event: 'error', data: { error: '500: long trace' } },
    ];
    const res = await askStream('Fail midway');
    const ev = events(res.body);
    expect(ev.map(([e]) => e)).toEqual(['token', 'error']);
    const problem = ev[1]![1] as { status: number; detail: string; answerId: string };
    expect(problem).toMatchObject({ status: 502, detail: expect.stringContaining('Connection error.') });
    const [stored] = await t.db.select().from(answers).where(eq(answers.id, problem.answerId));
    expect(stored).toMatchObject({ status: 'failed', error: 'Connection error.' });
  });

  it('a failure before the first token is a plain HTTP error, not a stream', async () => {
    streamEvents = () => [{ event: 'error', data: { text: 'model not loaded' } }];
    const res = await askStream('Fail early');
    expect(res.statusCode).toBe(502);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('an unexpected error after the stream opened still ends it, with an error event', async () => {
    const spy = vi.spyOn(AnswerService.prototype, 'ask').mockImplementation(async (input) => {
      input.onToken?.('RAG ');
      throw new Error('database went away');
    });
    try {
      const ev = events((await askStream('Break after a token')).body);
      expect(ev.map(([e]) => e)).toEqual(['token', 'error']);
      expect(ev[1]![1]).toMatchObject({ status: 500 });
      expect(JSON.stringify(ev[1]![1])).not.toContain('database went away');
    } finally {
      spy.mockRestore();
    }
  });

  it('when the caller hangs up mid-stream, the run is stopped and the answer stored as failed', async () => {
    hangAfterFirstToken = true;
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/v1/workspaces/ouc/answers`, {
      method: 'POST',
      headers: {
        authorization: auth.reader,
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question: 'Hang up' }),
      signal: ctrl.signal,
    });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    expect((await reader.read()).value).toContain('event: token');
    ctrl.abort();
    await expect
      .poll(async () => (await t.db.select().from(answers).where(eq(answers.question, 'Hang up')))[0], {
        timeout: 5_000,
      })
      .toMatchObject({ status: 'failed', error: 'The caller left before the answer finished.' });
  });

  it('an ungrounded answer streams its fixed text as one token', async () => {
    hits = [];
    const ev = events((await askStream('Off topic')).body);
    expect(ev.map(([e]) => e)).toEqual(['token', 'citations', 'done']);
    expect(ev[0]![1]).toEqual({ text: NOT_FOUND_TEXT });
  });
});
