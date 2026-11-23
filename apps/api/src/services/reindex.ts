import { documents, workspaces, type Database, type Workspace } from '@rag/db';
import { and, eq, inArray, notExists } from 'drizzle-orm';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import { ChromaService } from './chroma.js';
import type { DocumentEvents } from './document-events.js';
import type { IngestQueue } from './ingest-queue.js';
import { embeddingEndpoint, embeddingPrefixes, ProviderNotConfigured } from './providers.js';

export type ReindexDeps = {
  db: Database;
  chroma: ChromaService;
  queue: IngestQueue;
  events: DocumentEvents;
  config: Pick<Config, 'LMSTUDIO_BASE_URL' | 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'EMBEDDING_PREFIXES'>;
};

/** A new embedding provider or model for the workspace; the rest of its settings stay. */
export type EmbeddingChange = {
  embeddingProvider?: 'lmstudio' | 'openai' | 'gemini';
  embeddingModel?: string;
};

/** Documents still on their way through ingestion. */
const PENDING = ['queued', 'processing', 'transcribing'] as const;

/**
 * Re-run ingestion for every document of a workspace, optionally with a new embedding model
 * (the only way to change it: vectors from two models can't be compared, and their sizes may
 * differ, so the collection starts empty).
 *
 * 1. The Chroma collection is dropped and created again. If Chroma is down nothing changes.
 * 2. In one transaction the workspace becomes `reindexing` (with the new model, if any) and
 *    every document goes back to `queued`. A run already in flight finds its claim gone
 *    and does not mark its document ready (IngestProcessor); the queued job redoes it. The
 *    queue runs one document at a time (localConcurrency 1), so that job starts only after
 *    the stale run has given up.
 * 3. Every document is queued. The workspace returns to `active` when the last one is
 *    `ready` or `failed` (finishReindexIfDone), at once if it has no documents.
 */
export async function startReindex(
  deps: ReindexDeps,
  workspace: Workspace,
  change: EmbeddingChange = {},
): Promise<Workspace> {
  const { db, chroma, queue, events, config } = deps;
  if (workspace.status === 'reindexing') throw alreadyReindexing(workspace.slug);
  const settings = { ...workspace.settings, ...definedOnly(change) };
  // Every document is embedded again, so the prefixes can follow the current table (and EMBEDDING_PREFIXES).
  if (settings.embeddingModel)
    settings.embeddingPrefixes = embeddingPrefixes(settings.embeddingModel, config);
  try {
    embeddingEndpoint(settings.embeddingProvider ?? 'lmstudio', config);
  } catch (err) {
    if (err instanceof ProviderNotConfigured) {
      throw new HttpProblem(422, `The embedding provider can't be used: ${err.message}.`);
    }
    throw err;
  }

  const collection = ChromaService.collectionName(workspace.slug);
  await chroma.deleteCollection(collection);
  await chroma.ensureCollection(collection);

  const { row, queued } = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(workspaces).where(eq(workspaces.id, workspace.id)).for('update');
    if (!locked) throw new HttpProblem(404, `No workspace "${workspace.slug}"`);
    if (locked.status === 'reindexing') throw alreadyReindexing(workspace.slug);
    const [row] = await tx
      .update(workspaces)
      .set({ status: 'reindexing', settings })
      .where(eq(workspaces.id, workspace.id))
      .returning();
    const queued = await tx
      .update(documents)
      .set({ status: 'queued', attempts: 0, error: null, passageCount: null })
      .where(eq(documents.workspaceId, workspace.id))
      .returning();
    return { row: row!, queued };
  });

  for (const doc of queued) {
    events.emit({ workspaceId: workspace.id, document: doc });
    await queue.enqueue(doc.id);
  }
  // A workspace with no documents has nothing to wait for.
  if (!queued.length) return (await finishReindexIfDone(db, workspace.id)) ?? row;
  return row;
}

/**
 * Back to `active` once no document of the workspace is pending. One statement, so two
 * documents finishing at the same moment can't both miss it. Returns the updated workspace,
 * or undefined when it was not reindexing or still has work.
 */
export async function finishReindexIfDone(db: Database, workspaceId: string) {
  const [row] = await db
    .update(workspaces)
    .set({ status: 'active' })
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.status, 'reindexing'),
        notExists(
          db
            .select({ id: documents.id })
            .from(documents)
            .where(and(eq(documents.workspaceId, workspaceId), inArray(documents.status, [...PENDING]))),
        ),
      ),
    )
    .returning();
  return row;
}

/**
 * Searching, asking and chatting need the workspace's vectors, which a reindex rebuilds from
 * nothing. Until it finishes they answer 503 with Retry-After instead of half the material.
 */
export function assertSearchable(workspace: Workspace): void {
  if (workspace.status === 'reindexing') {
    throw new HttpProblem(
      503,
      `"${workspace.slug}" is being reindexed. Its documents come back as each one finishes; try again shortly.`,
      undefined,
      { 'retry-after': '30' },
    );
  }
}

function alreadyReindexing(slug: string) {
  return new HttpProblem(409, `"${slug}" is already being reindexed.`);
}

function definedOnly(change: EmbeddingChange): EmbeddingChange {
  return Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
}
