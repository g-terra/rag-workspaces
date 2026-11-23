import { documents, folders, messages, newId, workspaces } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { LangflowClient } from '@rag/langflow-client';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import { apiKeyAuthenticator } from '../auth/api-keys.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { ChromaService } from '../services/chroma.js';
import { testKeycloak } from '../test/tokens.js';

const url = process.env.TEST_DATABASE_URL;

type Run = { flow: string; body: { input_value: string; tweaks: Record<string, Record<string, unknown>> } };

const fenced = (v: unknown) => '```json\n' + JSON.stringify(v) + '\n```';
const outputBody = (outputs: Record<string, string>) => ({
  outputs: [
    {
      outputs: Object.entries(outputs).map(([component_id, text]) => ({
        component_id,
        results: { message: { text } },
      })),
    },
  ],
});

describe.skipIf(!url)('conversations (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: App;
  let docId = '';
  const auth = { admin: '', reader: '', other: '' };
  const runs: Run[] = [];
  let replyText = 'Reply';
  let failChat = false;

  const passage = () => ({
    rank: 1,
    id: `${docId}:0`,
    text: 'Chunk overlap keeps context across chunk borders.',
    score: 0.8,
    document_id: docId,
    page: 3,
    chunk_index: 0,
  });

  const langflowFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const flow = /\/run\/([^?]+)/.exec(String(input))![1]!;
    const body = JSON.parse(String(init?.body));
    runs.push({ flow, body });
    if (flow === 'rw-retrieve') {
      return Response.json(outputBody({ 'ChatOutput-passages': fenced({ passages: [passage()] }) }));
    }
    if (failChat) return Response.json({ detail: { message: 'model gone' } }, { status: 500 });
    const result = outputBody({
      'ChatOutput-answer': replyText,
      'ChatOutput-citations': fenced({ passages: [passage()] }),
    });
    if (String(input).includes('stream=true')) {
      const events = [
        { event: 'token', data: { chunk: replyText } },
        { event: 'end', data: { result } },
      ];
      return new Response(events.map((e) => JSON.stringify(e) + '\n\n').join(''));
    }
    return Response.json(result);
  }) as typeof fetch;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    const kc = await testKeycloak();
    auth.admin = `Bearer ${await kc.token({ sub: 'admin-1', realm_access: { roles: ['admin'] } })}`;
    auth.reader = `Bearer ${await kc.token({ sub: 'reader-1' })}`;
    auth.other = `Bearer ${await kc.token({ sub: 'reader-2' })}`;
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test', CHAT_HISTORY_TURNS: '2', DEFAULT_CHAT_MODEL: 'qwen-test' }),
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
      title: 'Langflow tips',
      fileName: 'tips.md',
      type: 'md',
      sizeBytes: 10,
      sha256: 'c'.repeat(64),
      storagePath: `ouc/${docId}.md`,
      status: 'ready',
      passageCount: 1,
    });
  });

  afterAll(async () => {
    await app?.close();
    await t?.drop();
  });

  beforeEach(() => {
    runs.length = 0;
    replyText = 'Reply';
    failChat = false;
  });

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    payload?: object,
    who: keyof typeof auth = 'reader',
  ) =>
    app.inject({ method, url: `/v1/workspaces/ouc${path}`, headers: { authorization: auth[who] }, payload });

  async function start() {
    const res = await call('POST', '/conversations', {});
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it('a first message gets a cited reply through rw-chat, and titles the conversation', async () => {
    const id = await start();
    replyText = 'Overlap keeps context [1].';
    const res = await call('POST', `/conversations/${id}/messages`, {
      content: 'How large should chunk overlap be?',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      conversationId: id,
      role: 'assistant',
      content: 'Overlap keeps context [1].',
      status: 'complete',
      grounded: true,
      model: 'qwen-test',
      citations: [{ rank: 1, documentTitle: 'Langflow tips', page: 3 }],
    });
    expect(runs.map((r) => r.flow)).toEqual(['rw-retrieve', 'rw-chat']);
    const chat = runs[1]!.body;
    expect(chat.input_value).toBe('How large should chunk overlap be?');
    expect(chat.tweaks.Prompt).toEqual({
      question: 'How large should chunk overlap be?',
      history: '(this is the first message)',
    });

    const got = await call('GET', `/conversations/${id}`);
    expect(got.json()).toMatchObject({
      title: 'How large should chunk overlap be?',
      messages: [{ role: 'user' }, { role: 'assistant', content: 'Overlap keeps context [1].' }],
    });
  });

  it("a message's style, else the workspace default, shapes and is stored on the reply only", async () => {
    const id = await start();
    const res = await call('POST', `/conversations/${id}/messages`, {
      content: 'Explain chunks',
      style: 'tutor',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().style).toBe('tutor');
    const llm = runs.find((r) => r.flow === 'rw-chat')!.body.tweaks.LLM!;
    expect(String(llm.system_message)).toContain('Response style: Tutor.');

    const setDefault = (style: string | null) =>
      app.inject({
        method: 'PATCH',
        url: '/v1/workspaces/ouc',
        headers: { authorization: auth.admin },
        payload: { settings: { style } },
      });
    await setDefault('concise');
    try {
      expect(
        (await call('POST', `/conversations/${id}/messages`, { content: 'And overlap?' })).json().style,
      ).toBe('concise');
    } finally {
      await setDefault(null);
    }

    const got = (await call('GET', `/conversations/${id}`)).json();
    expect(got.messages.map((m: { role: string; style: string | null }) => [m.role, m.style])).toEqual([
      ['user', null],
      ['assistant', 'tutor'],
      ['user', null],
      ['assistant', 'concise'],
    ]);
    expect(
      (await call('POST', `/conversations/${id}/messages`, { content: 'x', style: 'pirate' })).statusCode,
    ).toBe(400);
  });

  /** A folder in `ouc`, made straight in the database. */
  async function oucFolder() {
    const [ws] = await t.db.select().from(workspaces).where(eq(workspaces.slug, 'ouc'));
    const id = newId('folder');
    await t.db.insert(folders).values({ id, workspaceId: ws!.id, name: id });
    return id;
  }

  it('a message can limit its search to a folder; a folder from elsewhere is 404', async () => {
    const id = await start();
    const folderId = await oucFolder();
    const res = await call('POST', `/conversations/${id}/messages`, { content: 'In this folder?', folderId });
    expect(res.statusCode).toBe(201);
    expect(runs.map((r) => r.body.tweaks.Search!.folder)).toEqual([folderId, folderId]);
    const bad = await call('POST', `/conversations/${id}/messages`, { content: 'x', folderId: 'fld_nope' });
    expect(bad.statusCode).toBe(404);
  });

  it('follow-ups send the last turns as history and search with the previous question too', async () => {
    const id = await start();
    for (const [q, a] of [
      ['q1', 'a1'],
      ['q2', 'a2'],
      ['q3', 'a3'],
    ]) {
      replyText = a!;
      await call('POST', `/conversations/${id}/messages`, { content: q });
    }
    runs.length = 0;
    await call('POST', `/conversations/${id}/messages`, { content: 'and q4?' });
    const chat = runs.find((r) => r.flow === 'rw-chat')!.body;
    // CHAT_HISTORY_TURNS=2: only the last two turns.
    expect(chat.tweaks.Prompt).toEqual({
      question: 'and q4?',
      history: 'User: q2\nAssistant: a2\nUser: q3\nAssistant: a3',
    });
    expect(chat.input_value).toBe('q3\nand q4?');
    expect(runs[0]!.body.input_value).toBe('q3\nand q4?');
  });

  it('a reply stored before start times existed reads back with startSeconds null', async () => {
    const id = await start();
    replyText = 'Overlap keeps context [1].';
    const reply = (await call('POST', `/conversations/${id}/messages`, { content: 'old one' })).json();
    const [row] = await t.db.select().from(messages).where(eq(messages.id, reply.id));
    const old = row!.citations.map(({ startSeconds: _, ...c }) => c);
    await t.db.update(messages).set({ citations: old }).where(eq(messages.id, reply.id));
    const got = (await call('GET', `/conversations/${id}`)).json();
    const stored = got.messages.find((m: { id: string }) => m.id === reply.id);
    expect(stored.citations[0]).toMatchObject({ page: 3, startSeconds: null });
  });

  it('a reply that cites none of its passages is stored as ungrounded, with its text', async () => {
    const id = await start();
    replyText = 'The material does not say.';
    const res = await call('POST', `/conversations/${id}/messages`, { content: 'Who won in 1998?' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ content: 'The material does not say.', grounded: false });
    const rows = await t.db.select().from(messages).where(eq(messages.conversationId, id));
    expect(rows.find((m) => m.role === 'assistant')).toMatchObject({ grounded: false });
  });

  it('a failed reply is stored, left out of later history, and returned as 502', async () => {
    const id = await start();
    failChat = true;
    const res = await call('POST', `/conversations/${id}/messages`, { content: 'will fail' });
    expect(res.statusCode).toBe(502);
    const rows = await t.db.select().from(messages).where(eq(messages.conversationId, id));
    expect(rows.find((m) => m.role === 'assistant')).toMatchObject({ status: 'failed', content: null });

    failChat = false;
    runs.length = 0;
    await call('POST', `/conversations/${id}/messages`, { content: 'again' });
    const chat = runs.find((r) => r.flow === 'rw-chat')!.body;
    expect(chat.tweaks.Prompt).toMatchObject({ history: 'User: will fail' });
  });

  it('streams a reply', async () => {
    const id = await start();
    replyText = 'Streamed';
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/ouc/conversations/${id}/messages`,
      headers: { authorization: auth.reader, accept: 'text/event-stream' },
      payload: { content: 'stream please' },
    });
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('event: token\ndata: {"text":"Streamed"}');
    expect(res.body).toContain('event: done');
    expect(runs.find((r) => r.flow === 'rw-chat')!.body.tweaks.LLM).toMatchObject({ stream: true });
  });

  it('conversations are private: others get 404, admins can read, lists show only your own', async () => {
    const id = await start();
    await call('POST', `/conversations/${id}/messages`, { content: 'private' });
    expect((await call('GET', `/conversations/${id}`, undefined, 'other')).statusCode).toBe(404);
    expect((await call('POST', `/conversations/${id}/messages`, { content: 'x' }, 'other')).statusCode).toBe(
      404,
    );
    expect((await call('GET', `/conversations/${id}`, undefined, 'admin')).statusCode).toBe(200);
    const mine = await call('GET', '/conversations');
    expect(mine.json().data.map((c: { id: string }) => c.id)).toContain(id);
    expect((await call('GET', '/conversations', undefined, 'other')).json().data).toEqual([]);
  });

  it('lists page by most recent activity', async () => {
    const page1 = await call('GET', '/conversations?limit=2');
    expect(page1.json().data).toHaveLength(2);
    expect(page1.json().nextCursor).toBe('2');
    const page2 = await call('GET', `/conversations?limit=2&cursor=2`);
    const ids = [...page1.json().data, ...page2.json().data].map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('nobody else can delete your conversation', async () => {
    const id = await start();
    expect((await call('DELETE', `/conversations/${id}`, undefined, 'other')).statusCode).toBe(404);
    expect((await call('GET', `/conversations/${id}`)).statusCode).toBe(200);
  });

  it('a conversation is only found through its own workspace', async () => {
    const id = await start();
    await app.inject({
      method: 'POST',
      url: '/v1/workspaces',
      headers: { authorization: auth.admin },
      payload: { slug: 'personal', name: 'Personal' },
    });
    const res = await app.inject({
      url: `/v1/workspaces/personal/conversations/${id}`,
      headers: { authorization: auth.admin },
    });
    expect(res.statusCode).toBe(404);
  });

  it('delete removes the conversation and its messages', async () => {
    const id = await start();
    await call('POST', `/conversations/${id}/messages`, { content: 'bye' });
    expect((await call('DELETE', `/conversations/${id}`)).statusCode).toBe(204);
    expect((await call('GET', `/conversations/${id}`)).statusCode).toBe(404);
    expect(await t.db.select().from(messages).where(eq(messages.conversationId, id))).toEqual([]);
  });
});
