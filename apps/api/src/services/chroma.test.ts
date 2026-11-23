import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLLECTION_HNSW, ChromaService } from './chroma.js';

describe('ChromaService.ensureCollection', () => {
  it('creates the collection with the search-quality HNSW settings', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await new ChromaService({ CHROMA_URL: 'http://chroma:8000/' }, fetchFn).ensureCollection('ws_ouc');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'http://chroma:8000/api/v2/tenants/default_tenant/databases/default_database/collections',
    );
    expect(calls[0]!.body).toEqual({
      name: 'ws_ouc',
      get_or_create: true,
      configuration: { hnsw: { space: 'cosine', ef_construction: 200, ef_search: 400, max_neighbors: 32 } },
    });
  });

  it('matches the settings the ingest flow uses, whichever creates the collection first', async () => {
    const upsert = await readFile(
      path.resolve(import.meta.dirname, '../../../../langflow/components/rag_workspaces/chroma_upsert.py'),
      'utf8',
    );
    const match = /COLLECTION_HNSW = (\{[^}]*\})/.exec(upsert);
    expect(match, 'chroma_upsert.py defines COLLECTION_HNSW').not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual(COLLECTION_HNSW);
  });
});
