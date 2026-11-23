import { documents, workspaces, type Database, type Document } from '@rag/db';
import {
  LangflowError,
  messageText,
  outputsByComponent,
  parseJsonMessage,
  type LangflowClient,
} from '@rag/langflow-client';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { PgBoss } from 'pg-boss';
import type { Config } from '../config.js';
import { FLOWS } from '../flows.js';
import { ChromaService } from './chroma.js';
import type { DocumentEvents } from './document-events.js';
import type { IngestQueue } from './ingest-queue.js';
import { embeddingEndpoint } from './providers.js';
import { finishReindexIfDone } from './reindex.js';
import { isMedia, transcriptPath, type UploadStorage } from './storage.js';
import type { WhisperClient } from './whisper.js';

type IngestConfig = Pick<
  Config,
  | 'DEFAULT_CHUNK_SIZE'
  | 'DEFAULT_CHUNK_OVERLAP'
  | 'LMSTUDIO_BASE_URL'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'INGEST_TIMEOUT_MS'
  | 'INGEST_TIMEOUT_MS_PER_MB'
  | 'INGEST_MAX_ATTEMPTS'
>;

export type IngestDeps = {
  db: Database;
  storage: UploadStorage;
  /** Set when the video profile is on (`WHISPER_URL`); video and audio fail without it. */
  whisper?: WhisperClient;
  langflow: LangflowClient;
  chroma: ChromaService;
  events: DocumentEvents;
  config: IngestConfig;
  log: FastifyBaseLogger;
};

export type IngestOutcome = 'ready' | 'retry' | 'failed' | 'gone';

/** What the rw-ingest flow returns in its `ChatOutput-result` (flows/README.md). */
type IngestResult = { document_id: string; chunks: number; pages: number | null };

/**
 * Runs the ingest flow for one document and keeps its row honest. Separate from the queue
 * so it can be tested without pg-boss.
 *
 * - Every attempt starts clean: the document's vectors are deleted before the flow runs,
 *   so a retry after a half-finished run cannot leave duplicates.
 * - The run gets a timeout scaled by file size.
 * - A failure before the last attempt puts the document back to `queued` with the error
 *   (the queue retries with backoff); on the last attempt it becomes `failed`. Vectors a
 *   failed run left behind are deleted, so a failed document is never searchable.
 * - Deleting a document is refused while it is processing, but a delete that lands between
 *   loading the row and marking it `processing` is caught: the run's vectors are removed.
 * - A run only records its result on the row it claimed (`processing`, this attempt). A
 *   workspace reindex that sends the document back to `queued` mid-run wins: the stale run
 *   leaves the row alone and the queued job ingests it again into the new collection.
 * - The last document of a reindexing workspace to finish puts the workspace back to `active`.
 * - Video and audio are `transcribing` first: Whisper's transcript is saved next to the file and
 *   the flow ingests that instead, so passages carry start times. A transcript already on disk
 *   (a retry, a reindex) is reused, since Whisper is the slow part.
 */
export class IngestProcessor {
  constructor(private readonly deps: IngestDeps) {}

  async process(documentId: string): Promise<IngestOutcome> {
    const seen: { workspaceId?: string } = {};
    const outcome = await this.run(documentId, seen);
    if (outcome !== 'retry' && seen.workspaceId) {
      const done = await finishReindexIfDone(this.deps.db, seen.workspaceId);
      if (done) this.deps.log.info({ workspace: done.slug }, 'workspace reindex finished');
    }
    return outcome;
  }

  private async run(documentId: string, seen: { workspaceId?: string }): Promise<IngestOutcome> {
    const { db, langflow, chroma, config, log } = this.deps;
    const [row] = await db
      .select({ document: documents, workspace: workspaces })
      .from(documents)
      .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
      .where(eq(documents.id, documentId));
    if (!row) return 'gone'; // deleted while queued
    const { document, workspace } = row;
    const attempt = document.attempts + 1;
    // The claimed row, not the one read above: a move to another folder may have landed between.
    const media = isMedia(document.type);
    const claimed = await this.update(document.id, {
      status: media ? 'transcribing' : 'processing',
      attempts: attempt,
      error: null,
    });
    if (!claimed) return 'gone';
    seen.workspaceId = workspace.id;
    const claim = { attempts: attempt, status: 'processing' as const };

    const collection = ChromaService.collectionName(workspace.slug);
    const settings = workspace.settings;
    const timeoutMs =
      config.INGEST_TIMEOUT_MS + Math.ceil(document.sizeBytes / 1_048_576) * config.INGEST_TIMEOUT_MS_PER_MB;
    try {
      const embeddings = embeddingEndpoint(settings.embeddingProvider ?? 'lmstudio', config);
      let filePath = document.storagePath;
      if (media) {
        filePath = await this.transcribe(document, AbortSignal.timeout(timeoutMs));
        if (!(await this.update(document.id, { status: 'processing' }, { ...claim, status: 'transcribing' })))
          return 'gone';
      }
      await chroma.deleteDocumentVectors(collection, document.id);
      const run = await langflow.run(
        FLOWS.ingest,
        {
          session_id: `ingest-${document.id}-${attempt}`,
          tweaks: {
            Loader: {
              file_path: filePath,
              document_id: document.id,
              filename: document.fileName,
              // Passages carry the folder id, so searches can be limited to one folder.
              folder: claimed.folderId ?? '',
            },
            Split: {
              chunk_size: settings.chunkSize ?? config.DEFAULT_CHUNK_SIZE,
              chunk_overlap: settings.chunkOverlap ?? config.DEFAULT_CHUNK_OVERLAP,
            },
            Embeddings: {
              model: settings.embeddingModel,
              base_url: embeddings.baseUrl,
              api_key: embeddings.apiKey,
              // Pinned with the model; a workspace from before prefixes keeps embedding without them.
              document_prefix: settings.embeddingPrefixes?.document ?? '',
              query_prefix: settings.embeddingPrefixes?.query ?? '',
            },
            Upsert: { collection_name: collection, document_id: document.id },
          },
        },
        AbortSignal.timeout(timeoutMs),
      );
      const result = parseJsonMessage<IngestResult>(
        messageText(outputsByComponent(run)['ChatOutput-result']),
      );
      if (
        !(await this.update(
          document.id,
          { status: 'ready', passageCount: result.chunks, error: null },
          claim,
        ))
      ) {
        await chroma.deleteDocumentVectors(collection, document.id);
        return 'gone';
      }
      log.info({ documentId, chunks: result.chunks, attempt }, 'document ready');
      return 'ready';
    } catch (err) {
      const reason = describe(err, timeoutMs);
      const last = attempt >= config.INGEST_MAX_ATTEMPTS;
      await chroma.deleteDocumentVectors(collection, document.id).catch((cleanupErr: unknown) => {
        // The next attempt or a reindex starts by deleting them again.
        log.warn({ documentId, err: cleanupErr }, 'could not remove vectors of a failed run');
      });
      // Superseded (a workspace reindex requeued it) or deleted: the row is not ours to fail.
      const failed = { status: last ? ('failed' as const) : ('queued' as const), error: reason };
      if (
        !(await this.update(document.id, failed, claim)) &&
        !(media && (await this.update(document.id, failed, { ...claim, status: 'transcribing' })))
      )
        return 'gone';
      log.warn({ documentId, attempt, last, reason }, 'ingestion failed');
      return last ? 'failed' : 'retry';
    }
  }

  /** The transcript's path on the uploads volume, asking Whisper for it unless it is there already. */
  private async transcribe(document: Document, signal: AbortSignal): Promise<string> {
    const { storage, whisper, log } = this.deps;
    if (await storage.exists(transcriptPath(document.storagePath)))
      return transcriptPath(document.storagePath);
    if (!whisper)
      throw new Error('Video and audio need the video profile (WHISPER_URL is not set); see docs/setup.md.');
    const started = Date.now();
    const transcript = await whisper.transcribe(
      storage.absolute(document.storagePath),
      document.fileName,
      signal,
    );
    log.info(
      { documentId: document.id, segments: transcript.segments.length, ms: Date.now() - started },
      'transcribed',
    );
    return storage.writeTranscript(document.storagePath, transcript);
  }

  /**
   * After a crash, documents left mid-run go back to `queued`. Returns every queued
   * document id, so the caller can make sure each has a job.
   */
  async recover(): Promise<string[]> {
    const { db } = this.deps;
    const stuck = await db
      .update(documents)
      .set({ status: 'queued' })
      .where(inArray(documents.status, ['processing', 'transcribing']))
      .returning();
    for (const doc of stuck) this.deps.events.emit({ workspaceId: doc.workspaceId, document: doc });
    if (stuck.length) this.deps.log.warn({ count: stuck.length }, 'requeued documents left mid-run');
    // A reindex whose last document finished just before a crash would otherwise stay open.
    const reindexing = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.status, 'reindexing'));
    for (const w of reindexing) await finishReindexIfDone(db, w.id);
    const queued = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.status, 'queued'));
    return queued.map((q) => q.id);
  }

  /**
   * Returns the updated row, or undefined when the document was deleted meanwhile. With a
   * `claim`, only the run's own row is updated: still in the claimed status, at the attempt it took.
   */
  private async update(
    id: string,
    set: Partial<Document>,
    claim?: { attempts: number; status: 'processing' | 'transcribing' },
  ) {
    const where = claim
      ? and(eq(documents.id, id), eq(documents.status, claim.status), eq(documents.attempts, claim.attempts))
      : eq(documents.id, id);
    const [doc] = await this.deps.db.update(documents).set(set).where(where).returning();
    if (doc) this.deps.events.emit({ workspaceId: doc.workspaceId, document: doc });
    return doc;
  }
}

/** One line a person can act on, stored as the document's `error`. */
function describe(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `Ingestion took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`;
  }
  if (err instanceof LangflowError) return err.detail || err.message;
  return err instanceof Error ? err.message : String(err);
}

const QUEUE = 'ingest';

/**
 * The ingestion queue on Postgres (pg-boss, decision 15). One file at a time across the
 * install by default: LM Studio is one local model server, so parallel runs only make each
 * file slower. Retries back off exponentially.
 */
export class PgBossIngestQueue implements IngestQueue {
  private boss: PgBoss | undefined;

  constructor(
    private readonly databaseUrl: string,
    private readonly processor: IngestProcessor,
    private readonly log: FastifyBaseLogger,
    private readonly opts: {
      maxAttempts: number;
      retryDelaySeconds?: number;
      pollingIntervalSeconds?: number;
    },
  ) {}

  /** Connect and create the queue. Uploads can be queued from here on. */
  async start(): Promise<void> {
    const boss = new PgBoss({ connectionString: this.databaseUrl, schema: 'pgboss' });
    boss.on('error', (err) => this.log.error({ err }, 'queue error'));
    await boss.start();
    await boss.createQueue(QUEUE, {
      // At most one waiting and one running job per document (the singleton key).
      policy: 'stately',
      retryLimit: this.opts.maxAttempts - 1,
      retryDelay: this.opts.retryDelaySeconds ?? 15,
      retryBackoff: true,
      // A safety net only; the flow run has its own, size-based timeout.
      expireInSeconds: 3 * 60 * 60,
    });
    this.boss = boss;
  }

  /** Start taking jobs, after recovering documents a crash left mid-run. Call once Langflow is usable. */
  async startWorking(): Promise<void> {
    const boss = this.boss;
    if (!boss) throw new Error('ingest queue not started');
    // Recover first: a worker could otherwise pick up a job and mark its document `processing`,
    // and recovery would then put that live run back to `queued`.
    for (const id of await this.processor.recover()) await this.enqueue(id);
    await boss.work<{ documentId: string }>(
      QUEUE,
      { localConcurrency: 1, batchSize: 1, pollingIntervalSeconds: this.opts.pollingIntervalSeconds ?? 2 },
      async ([job]) => {
        if (!job) return;
        const outcome = await this.processor.process(job.data.documentId);
        // Throwing hands the job back to pg-boss, which retries it after a backoff.
        if (outcome === 'retry') throw new Error(`ingestion of ${job.data.documentId} failed; will retry`);
      },
    );
  }

  async enqueue(documentId: string): Promise<void> {
    if (!this.boss) throw new Error('ingest queue not started');
    await this.boss.send(QUEUE, { documentId }, { singletonKey: documentId });
  }

  async stop(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
  }
}
