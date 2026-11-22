import type { Config } from '../config.js';

/**
 * The few Chroma operations the API does itself (decision 18: the API manages collections
 * and deletes vectors; writing and searching vectors happens inside the Langflow flows).
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
    const found = await this.fetchFn(`${this.base}/collections/${encodeURIComponent(collection)}`);
    if (found.status === 404) return;
    if (!found.ok) throw new Error(`Chroma: get collection ${collection} failed: HTTP ${found.status}`);
    const { id } = (await found.json()) as { id: string };
    const res = await this.fetchFn(`${this.base}/collections/${id}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where: { document_id: documentId } }),
    });
    if (!res.ok) throw new Error(`Chroma: delete vectors of ${documentId} failed: HTTP ${res.status}`);
  }
}
