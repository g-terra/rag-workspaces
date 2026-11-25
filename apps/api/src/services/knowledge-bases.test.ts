import { LangflowClient } from '@rag/langflow-client';
import { describe, expect, it } from 'vitest';
import { KnowledgeBaseService } from './knowledge-bases.js';

type Call = { method: string; path: string; body: unknown };

function service(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const call = {
      method: init?.method ?? 'GET',
      path: String(url).replace('http://lf/api/v1', ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  const langflow = new LangflowClient({ baseUrl: 'http://lf', apiKey: 'test', fetch: fetchFn });
  return { calls, kb: new KnowledgeBaseService(langflow) };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('KnowledgeBaseService', () => {
  it('creates a SQLite knowledge base with cosine scores and the workspace embedding model', async () => {
    const { calls, kb } = service(() => json({}, 201));
    await kb.ensure('ws_ouc', { embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small' });
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/knowledge_bases/',
        body: {
          name: 'ws_ouc',
          embedding_provider: 'OpenAI',
          embedding_model: 'text-embedding-3-small',
          backend_type: 'sqlite',
          backend_config: { metric: 'cosine' },
        },
      },
    ]);
  });

  it('accepts one that exists, and reports other failures', async () => {
    await service(() => json({ detail: 'exists' }, 409)).kb.ensure('ws_ouc', { embeddingModel: 'm' });
    await expect(
      service(() => json({ detail: 'boom' }, 500)).kb.ensure('ws_ouc', { embeddingModel: 'm' }),
    ).rejects.toThrow('boom');
  });

  it('treats deleting a missing one as done', async () => {
    await service(() => json({ detail: 'no' }, 404)).kb.delete('ws_ouc');
    await expect(service(() => json({ detail: 'boom' }, 500)).kb.delete('ws_ouc')).rejects.toThrow('boom');
  });

  it('deletes a document through the rw-delete flow', async () => {
    const { calls, kb } = service(() => json({ outputs: [] }));
    await kb.deleteDocument('ws_ouc', 'doc_1');
    expect(calls[0]).toMatchObject({
      path: '/run/rw-delete?stream=false',
      body: { tweaks: { Delete: { knowledge_base: 'ws_ouc', document_id: 'doc_1' } } },
    });
  });

  it('reads the wanted chunks of one document, across result pages', async () => {
    const chunk = (i: number) => ({ content: `t${i}`, metadata: { chunk_index: String(i), page: '2' } });
    const { calls, kb } = service((c) =>
      json({ chunks: c.path.includes('page=1') ? [chunk(0), chunk(1)] : [chunk(2)], total_pages: 2 }),
    );
    expect(await kb.getChunks('ws_ouc', 'doc_1', [1, 2])).toEqual([
      { id: 'doc_1:1', text: 't1', metadata: { chunk_index: 1, page: 2 } },
      { id: 'doc_1:2', text: 't2', metadata: { chunk_index: 2, page: 2 } },
    ]);
    expect(calls[0]!.path).toBe('/knowledge_bases/ws_ouc/chunks?meta_document_id=doc_1&limit=100&page=1');
  });
});
