import { LangflowError, type LangflowClient } from '@rag/langflow-client';
import { FLOWS } from '../flows.js';

/** Langflow's names for our embedding providers. LM Studio is its "OpenAI Compatible" one. */
const PROVIDERS: Record<string, string> = {
  lmstudio: 'OpenAI Compatible',
  openai: 'OpenAI',
  gemini: 'Google Generative AI',
};

/** The knowledge-base operations the API does itself. Ingestion and search run in the flows. */
export class KnowledgeBaseService {
  constructor(private readonly langflow: LangflowClient) {}

  /** One knowledge base per workspace. */
  static nameFor(slug: string) {
    return `ws_${slug}`;
  }

  /** Create it if missing. Its embedding model is fixed from here on. */
  async ensure(
    name: string,
    settings: { embeddingProvider?: string | null; embeddingModel?: string | null },
  ): Promise<void> {
    await this.langflow
      .knowledgeBases('POST', '/', {
        name,
        embedding_provider: PROVIDERS[settings.embeddingProvider ?? 'lmstudio'],
        embedding_model: settings.embeddingModel,
        backend_type: 'sqlite',
        backend_config: { metric: 'cosine' },
      })
      .catch(ignoring(409));
  }

  /** Delete it with every vector in it. A missing one is not an error. */
  async delete(name: string): Promise<void> {
    await this.langflow.knowledgeBases('DELETE', `/${encodeURIComponent(name)}`).catch(ignoring(404));
  }

  /** Delete one document's chunks. Langflow has no route for it, so a flow does it. */
  async deleteDocument(name: string, documentId: string): Promise<void> {
    await this.langflow.run(FLOWS.delete, {
      session_id: `delete-${documentId}`,
      tweaks: { Delete: { knowledge_base: name, document_id: documentId } },
    });
  }

  /** Read a document's chunks by number. Langflow can only list, so this scans the document's. */
  async getChunks(name: string, documentId: string, wanted: number[]): Promise<StoredChunk[]> {
    const found: StoredChunk[] = [];
    for (let page = 1, pages = 1; page <= pages; page++) {
      const res = (await this.langflow.knowledgeBases(
        'GET',
        `/${encodeURIComponent(name)}/chunks?meta_document_id=${documentId}&limit=100&page=${page}`,
      )) as { chunks: { content: string; metadata: Record<string, unknown> }[]; total_pages: number };
      pages = res.total_pages;
      for (const { content, metadata } of res.chunks) {
        // Langflow stores every column as text.
        const numbers = Object.fromEntries(
          ['chunk_index', 'page', 'start_seconds'].flatMap((k) =>
            metadata[k] === undefined ? [] : [[k, Number(metadata[k])]],
          ),
        );
        if (wanted.includes(numbers.chunk_index!))
          found.push({ id: `${documentId}:${numbers.chunk_index}`, text: content, metadata: numbers });
      }
    }
    return found;
  }
}

const ignoring = (status: number) => (err: unknown) => {
  if (!(err instanceof LangflowError && err.status === status)) throw err;
};

export type StoredChunk = { id: string; text: string; metadata: Record<string, unknown> };
