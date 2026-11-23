import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RagApi } from './api.js';
import { createServer } from './tools.js';

type Seen = { method: string; url: string; auth: string | null; body: unknown };

describe('MCP tools', () => {
  const seen: Seen[] = [];
  let respond: (url: URL) => Response;
  let client: Client;

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({
      method: init?.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      auth: new Headers(init?.headers).get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return respond(url);
  }) as typeof fetch;

  beforeEach(async () => {
    seen.length = 0;
    respond = () => Response.json({ data: [], nextCursor: null });
    const api = new RagApi({ baseUrl: 'http://api:3000/', apiKey: 'rw_test', fetch: fakeFetch });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer(api, '0.0.0').connect(serverSide);
    client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
  });
  afterEach(() => client.close());

  const text = (r: Awaited<ReturnType<Client['callTool']>>) =>
    (r.content as { type: string; text: string }[])[0]!.text;

  it('lists the tools, with only ask marked as not read-only', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'ask',
      'list_documents',
      'list_folders',
      'list_styles',
      'list_workspaces',
      'read_passage',
      'search_passages',
    ]);
    const writes = tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name);
    expect(writes).toEqual(['ask']);
  });

  it('searches with the key, the query and the folder', async () => {
    respond = () =>
      Response.json({ data: [{ id: 'psg_1', score: 0.8, text: 'Langflow is…' }], query: 'langflow' });
    const res = await client.callTool({
      name: 'search_passages',
      arguments: { workspace: 'ouc', query: 'what is langflow', limit: 3, folderId: 'fld_1' },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(text(res))).toEqual([{ id: 'psg_1', score: 0.8, text: 'Langflow is…' }]);
    expect(seen).toEqual([
      {
        method: 'GET',
        url: '/v1/workspaces/ouc/passages?query=what+is+langflow&limit=3&folderId=fld_1',
        auth: 'Bearer rw_test',
        body: undefined,
      },
    ]);
  });

  it('leaves out a folder that was not given', async () => {
    await client.callTool({ name: 'list_documents', arguments: { workspace: 'ouc' } });
    expect(seen[0]!.url).toBe('/v1/workspaces/ouc/documents');
  });

  it("turns an API problem into a tool error with the API's reason", async () => {
    respond = () =>
      new Response(JSON.stringify({ status: 429, detail: 'Too many searches.' }), {
        status: 429,
        headers: { 'content-type': 'application/problem+json', 'retry-after': '12' },
      });
    const res = await client.callTool({
      name: 'search_passages',
      arguments: { workspace: 'ouc', query: 'x' },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe('HTTP 429: Too many searches. (retry after 12 s)');
  });

  it('lists response styles, so the agent can pick one for ask', async () => {
    respond = () =>
      Response.json({
        data: [
          {
            slug: 'academic',
            name: 'Academic',
            description: 'Formal.',
            instructions: 'Long text…',
            builtIn: true,
          },
          {
            slug: 'socratic',
            name: 'Socratic',
            description: 'Asks back.',
            instructions: '…',
            builtIn: false,
          },
        ],
      });
    const res = await client.callTool({ name: 'list_styles', arguments: {} });
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1/styles' });
    expect(JSON.parse(text(res))).toEqual([
      { slug: 'academic', name: 'Academic', description: 'Formal.' },
      { slug: 'socratic', name: 'Socratic', description: 'Asks back.' },
    ]);
  });

  it('asks in a response style, and says which style the answer used', async () => {
    respond = () =>
      Response.json({
        id: 'ans_2',
        grounded: true,
        text: 'Short [1].',
        citations: [],
        model: 'm',
        style: 'concise',
      });
    const res = await client.callTool({
      name: 'ask',
      arguments: { workspace: 'ouc', question: 'What is Langflow?', style: 'concise' },
    });
    expect(seen[0]).toMatchObject({ body: { question: 'What is Langflow?', style: 'concise' } });
    expect(JSON.parse(text(res))).toMatchObject({ answerId: 'ans_2', style: 'concise' });
    // null asks for no style, even where the workspace has a default.
    await client.callTool({ name: 'ask', arguments: { workspace: 'ouc', question: 'Plain?', style: null } });
    expect(seen[1]).toMatchObject({ body: { question: 'Plain?', style: null } });
  });

  it('asks, and returns the answer with its citations', async () => {
    respond = () =>
      Response.json({
        id: 'ans_1',
        workspace: 'ouc',
        question: 'q',
        grounded: true,
        text: 'Langflow builds flows [1].',
        citations: [
          {
            rank: 1,
            passageId: 'psg_1',
            documentId: 'doc_1',
            documentTitle: 'Week 1',
            page: 3,
            startSeconds: null,
            snippet: 'Langflow…',
            score: 0.9,
          },
        ],
        model: 'qwen3-8b',
        style: null,
        createdAt: '2026-11-23T00:00:00.000Z',
      });
    const res = await client.callTool({
      name: 'ask',
      arguments: { workspace: 'ouc', question: 'What is Langflow?', folderId: 'fld_1' },
    });
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: '/v1/workspaces/ouc/answers',
      body: { question: 'What is Langflow?', folderId: 'fld_1' },
    });
    expect(JSON.parse(text(res))).toEqual({
      answerId: 'ans_1',
      grounded: true,
      text: 'Langflow builds flows [1].',
      citations: [
        {
          rank: 1,
          passageId: 'psg_1',
          documentTitle: 'Week 1',
          page: 3,
          startSeconds: null,
          snippet: 'Langflow…',
        },
      ],
      model: 'qwen3-8b',
      style: null,
    });
  });

  it('says when the API cannot be reached', async () => {
    respond = () => {
      throw new TypeError('fetch failed');
    };
    const res = await client.callTool({ name: 'list_workspaces', arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Could not reach rag-workspaces');
  });
});
