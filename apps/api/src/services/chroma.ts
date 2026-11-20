import type { Config } from '../config.js';

/**
 * The few Chroma operations the API does itself (decision 18: the API manages collections,
 * deletes vectors and reads chunks back by id; writing vectors and similarity search happen
 * inside the Langflow flows, because they need the embedding model).
 */
export class ChromaService {
  private readonly base: string;
  constructor(
    config: Pick<Config, 'CHROMA_URL'>,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.base = `${config.CHROMA_URL.replace(/\/+$/, '')}/api/v2/tenants/default_tenant/databases/default_database`;
  }

  /** One collection per workspace. */
  static collectionName(slug: string) {
    return `ws_${slug}`;
  }

  /** Create the collection if missing, with the same settings the ingest flow uses (cosine). */
  async ensureCollection(name: string): Promise<void> {
    const res = await this.fetchFn(`${this.base}/collections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, get_or_create: true, configuration: { hnsw: { space: 'cosine' } } }),
    });
    if (!res.ok)
      throw new Error(`Chroma: create collection ${name} failed: HTTP ${res.status} ${await res.text()}`);
  }

  /** Delete the collection and every vector in it. A missing collection is not an error. */
  async deleteCollection(name: string): Promise<void> {
    const res = await this.fetchFn(`${this.base}/collections/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Chroma: delete collection ${name} failed: HTTP ${res.status} ${await res.text()}`);
    }
  }

  /** Delete every vector of one document. A missing collection means there is nothing to delete. */
  async deleteDocumentVectors(collection: string, documentId: string): Promise<void> {
    const id = await this.collectionId(collection);
    if (!id) return;
    const res = await this.fetchFn(`${this.base}/collections/${id}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where: { document_id: documentId } }),
    });
    if (!res.ok) throw new Error(`Chroma: delete vectors of ${documentId} failed: HTTP ${res.status}`);
  }

  /**
   * Read stored chunks by vector id (`<document id>:<chunk index>`), no similarity search.
   * Missing ids are left out; a missing collection gives an empty list.
   */
  async getChunks(collection: string, ids: string[]): Promise<StoredChunk[]> {
    if (!ids.length) return [];
    const id = await this.collectionId(collection);
    if (!id) return [];
    const res = await this.fetchFn(`${this.base}/collections/${id}/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, include: ['documents', 'metadatas'] }),
    });
    if (!res.ok) throw new Error(`Chroma: get ${ids.length} chunk(s) failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      ids: string[];
      documents: (string | null)[];
      metadatas: (Record<string, unknown> | null)[];
    };
    return body.ids.map((vectorId, i) => ({
      id: vectorId,
      text: body.documents[i] ?? '',
      metadata: body.metadatas[i] ?? {},
    }));
  }

  /** The collection's internal id, or `null` when it does not exist. */
  private async collectionId(name: string): Promise<string | null> {
    const res = await this.fetchFn(`${this.base}/collections/${encodeURIComponent(name)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Chroma: get collection ${name} failed: HTTP ${res.status}`);
    return ((await res.json()) as { id: string }).id;
  }
}

export type StoredChunk = { id: string; text: string; metadata: Record<string, unknown> };
