import { documents, type Database, type Workspace } from '@rag/db';
import type { ScoredPassage } from '@rag/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { messageText, outputsByComponent, parseJsonMessage, type LangflowClient } from '@rag/langflow-client';
import type { Config } from '../config.js';
import { FLOWS } from '../flows.js';
import { ChromaService } from './chroma.js';
import { embeddingEndpoint } from './providers.js';

/**
 * Passage ids. Chroma stores a chunk as `<document id>:<chunk index>` (`doc_01J…:3`); the API
 * shows it as `psg_01J…_3` (docs/api-schema.md), so callers never see storage ids.
 */
export function passageId(documentId: string, chunkIndex: number): string {
  return `psg_${documentId.replace(/^doc_/, '')}_${chunkIndex}`;
}

/** The document id and chunk index inside a passage id, or `null` if it is not one. */
export function parsePassageId(id: string): { documentId: string; chunkIndex: number } | null {
  const m = /^psg_([0-9A-HJKMNP-TV-Z]{26})_(\d{1,6})$/.exec(id);
  return m ? { documentId: `doc_${m[1]}`, chunkIndex: Number(m[2]) } : null;
}

export function vectorId(documentId: string, chunkIndex: number): string {
  return `${documentId}:${chunkIndex}`;
}

/** One hit as the `rw-retrieve` and `rw-answer` flows return it (flows/README.md). */
export type FlowPassage = {
  rank: number;
  id: string;
  text: string;
  score: number;
  document_id: string | null;
  filename: string | null;
  folder: string | null;
  page: number | null;
  start_seconds?: number | null;
  chunk_index: number | null;
};

type RetrievalConfig = Pick<
  Config,
  'DEFAULT_TOP_K' | 'DEFAULT_MIN_SCORE' | 'LMSTUDIO_BASE_URL' | 'OPENAI_API_KEY' | 'GEMINI_API_KEY'
>;

export type SearchOptions = { limit?: number; minScore?: number; folderId?: string };

/**
 * The tweaks that turn a question into passages: which embedding model to use (the one the
 * workspace was indexed with) and which collection to search. Shared by `rw-retrieve` and
 * `rw-answer`, which have the same `Embeddings` and `Search` nodes.
 */
export function searchTweaks(workspace: Workspace, config: RetrievalConfig, opts: SearchOptions = {}) {
  const settings = workspace.settings;
  const embeddings = embeddingEndpoint(settings.embeddingProvider ?? 'lmstudio', config);
  const limit = opts.limit ?? settings.topK ?? config.DEFAULT_TOP_K;
  const minScore = opts.minScore ?? settings.minScore ?? config.DEFAULT_MIN_SCORE;
  return {
    Embeddings: {
      model: settings.embeddingModel,
      base_url: embeddings.baseUrl,
      api_key: embeddings.apiKey,
      // Both, so the node never keeps a value from the flow file: documents are not embedded here.
      document_prefix: settings.embeddingPrefixes?.document ?? '',
      query_prefix: settings.embeddingPrefixes?.query ?? '',
    },
    Search: {
      collection_name: ChromaService.collectionName(workspace.slug),
      top_k: limit,
      min_score: minScore,
      // Passages carry their document's folder id (written at ingestion, updated on a move).
      folder: opts.folderId ?? '',
    },
  };
}

/** Run `rw-retrieve`: embed the query, search the workspace's collection, best first. */
export async function retrieve(
  langflow: LangflowClient,
  workspace: Workspace,
  query: string,
  config: RetrievalConfig & Pick<Config, 'RETRIEVE_TIMEOUT_MS'>,
  opts: SearchOptions = {},
): Promise<FlowPassage[]> {
  const tweaks = searchTweaks(workspace, config, opts);
  const run = await langflow.run(
    FLOWS.retrieve,
    { input_value: query, session_id: `retrieve-${crypto.randomUUID()}`, tweaks },
    AbortSignal.timeout(config.RETRIEVE_TIMEOUT_MS),
  );
  const text = messageText(outputsByComponent(run)['ChatOutput-passages']);
  const parsed = text ? parseJsonMessage<unknown>(text) : [];
  return normalise(parsed);
}

/**
 * The flow's output, whichever way Langflow wrapped it: a list, or the search component's
 * `{ passages: [...] }` object.
 */
export function normalise(parsed: unknown): FlowPassage[] {
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { passages?: unknown }).passages)
      ? (parsed as { passages: unknown[] }).passages
      : [];
  return (list as FlowPassage[]).filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string');
}

/**
 * Flow hits as API passages, with titles from our database. A hit whose document is gone
 * (deleted a moment ago) is dropped. `rank` is the `[n]` the model saw.
 */
export async function resolveHits(
  db: Database,
  workspace: Pick<Workspace, 'id' | 'slug'>,
  hits: FlowPassage[],
): Promise<(ScoredPassage & { rank: number })[]> {
  const ids = [...new Set(hits.map((h) => h.document_id).filter((id): id is string => !!id))];
  const docs = ids.length
    ? await db
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(
          and(
            eq(documents.workspaceId, workspace.id),
            inArray(documents.id, ids),
            // Hits from a document that is not ready (re-indexing, or a failed run's leftovers) are dropped.
            eq(documents.status, 'ready'),
          ),
        )
    : [];
  const titles = new Map(docs.map((d) => [d.id, d.title]));
  return hits.flatMap((h) => {
    const title = h.document_id ? titles.get(h.document_id) : undefined;
    if (!h.document_id || title === undefined) return [];
    const index = h.chunk_index ?? Number(h.id.split(':').pop());
    return [
      {
        rank: h.rank,
        id: passageId(h.document_id, index),
        workspace: workspace.slug,
        documentId: h.document_id,
        documentTitle: title,
        page: typeof h.page === 'number' ? h.page : null,
        startSeconds: typeof h.start_seconds === 'number' ? h.start_seconds : null,
        chunkIndex: index,
        text: h.text,
        score: h.score,
      },
    ];
  });
}
