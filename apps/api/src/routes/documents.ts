import { createReadStream } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import multipart from '@fastify/multipart';
import { documents, newId, type Database, type Document as DocumentRow } from '@rag/db';
import { Document, DocumentQuery, UploadResult, WorkspaceSlug, page } from '@rag/shared';
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireWorkspace } from '../auth/access.js';
import { openEventStream } from '../sse.js';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import { ChromaService } from '../services/chroma.js';
import type { DocumentEvents } from '../services/document-events.js';
import type { IngestQueue } from '../services/ingest-queue.js';
import type { UploadStorage } from '../services/storage.js';
import { FileTooLarge, detectType } from '../services/storage.js';

export type DocumentRoutesOptions = {
  db: Database;
  storage: UploadStorage;
  chroma: ChromaService;
  queue: IngestQueue;
  events: DocumentEvents;
  config: Pick<Config, 'MAX_UPLOAD_BYTES' | 'MAX_UPLOAD_FILES'>;
};

/** How often an idle status stream gets a comment line, to keep it open through proxies. */
const HEARTBEAT_MS = 15_000;

const SlugParams = z.object({ slug: WorkspaceSlug });
const DocParams = SlugParams.extend({ documentId: z.string() });
const common = { tags: ['documents'], security: [{ bearerAuth: [] }] };
const MIME: Record<DocumentRow['type'], string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

export const documentRoutes: FastifyPluginAsyncZod<DocumentRoutesOptions> = async (app, opts) => {
  const { db, storage, chroma, queue, events, config } = opts;
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: config.MAX_UPLOAD_FILES, fields: 20 },
  });

  // Open status streams, ended when the server shuts down so `close()` doesn't wait on them.
  const streams = new Set<ServerResponse>();
  app.addHook('onClose', async () => {
    for (const res of streams) res.end();
  });

  const toApi = (d: DocumentRow, slug: string): Document => ({
    id: d.id,
    workspace: slug,
    title: d.title,
    fileName: d.fileName,
    type: d.type,
    sizeBytes: d.sizeBytes,
    sha256: d.sha256,
    status: d.status,
    attempts: d.attempts,
    error: d.error,
    passageCount: d.passageCount,
    tags: d.tags,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  });

  async function loadDocument(workspaceId: string, documentId: string) {
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)));
    if (!row) throw new HttpProblem(404, `No document ${documentId}`);
    return row;
  }

  app.post(
    '/v1/workspaces/:slug/documents',
    {
      schema: {
        ...common,
        summary: 'Upload files',
        description:
          'Multipart form with one or more `files` parts. Accepts PDF, DOCX, TXT and MD, checked by content. ' +
          'Each new file is stored and queued for ingestion; a file already in the workspace (same SHA-256) ' +
          'returns the existing document with `duplicate: true`. Oversized files get 413, unsupported ones 415, ' +
          'and nothing from that request is kept. Empty files get 400.',
        consumes: ['multipart/form-data'],
        params: SlugParams,
        response: { 201: UploadResult },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      if (!req.isMultipart())
        throw new HttpProblem(415, 'Send multipart/form-data with one or more "files" parts.');

      // Stage every file first, so one bad file rejects the whole request and nothing is half-kept.
      const staged: {
        fileName: string;
        type: DocumentRow['type'];
        file: Awaited<ReturnType<UploadStorage['stage']>>;
      }[] = [];
      try {
        for await (const part of req.files()) {
          const fileName = path.basename(part.filename || 'upload');
          let file;
          try {
            file = await storage.stage(workspace.slug, part.file);
          } catch (err) {
            if (err instanceof FileTooLarge || part.file.truncated) {
              throw new HttpProblem(413, `"${fileName}" is larger than ${config.MAX_UPLOAD_BYTES} bytes.`);
            }
            throw err;
          }
          if (part.file.truncated) {
            await storage.discard(file);
            throw new HttpProblem(413, `"${fileName}" is larger than ${config.MAX_UPLOAD_BYTES} bytes.`);
          }
          if (file.sizeBytes === 0) {
            await storage.discard(file);
            throw new HttpProblem(400, `"${fileName}" is empty.`);
          }
          const type = detectType(fileName, await storage.head(file.tmpPath));
          if (!type) {
            await storage.discard(file);
            throw new HttpProblem(415, `"${fileName}" is not a supported file. Use PDF, DOCX, TXT or MD.`);
          }
          staged.push({ fileName, type, file });
        }
      } catch (err) {
        await Promise.all(staged.map((s) => storage.discard(s.file)));
        if (err instanceof Error && 'code' in err && err.code === 'FST_FILES_LIMIT') {
          throw new HttpProblem(413, `At most ${config.MAX_UPLOAD_FILES} files per request.`);
        }
        throw err;
      }
      if (!staged.length) throw new HttpProblem(400, 'No files in the request. Send them as "files" parts.');

      const results = [];
      for (const s of staged) {
        const [existing] = await db
          .select()
          .from(documents)
          .where(and(eq(documents.workspaceId, workspace.id), eq(documents.sha256, s.file.sha256)));
        if (existing) {
          await storage.discard(s.file);
          results.push({ document: toApi(existing, workspace.slug), duplicate: true });
          continue;
        }
        const id = newId('document');
        const storagePath = await storage.commit(s.file, workspace.slug, id, s.type);
        const inserted = await db
          .insert(documents)
          .values({
            id,
            workspaceId: workspace.id,
            title: path.parse(s.fileName).name,
            fileName: s.fileName,
            type: s.type,
            sizeBytes: s.file.sizeBytes,
            sha256: s.file.sha256,
            storagePath,
          })
          .onConflictDoNothing()
          .returning()
          .catch(async (err: unknown) => {
            // No row points at the file, so nothing would ever clean it up.
            await storage.remove(storagePath);
            throw err;
          });
        if (!inserted[0]) {
          // The same file arrived twice at once (two parts, or two requests): keep the first.
          await storage.remove(storagePath);
          const [winner] = await db
            .select()
            .from(documents)
            .where(and(eq(documents.workspaceId, workspace.id), eq(documents.sha256, s.file.sha256)));
          results.push({ document: toApi(winner!, workspace.slug), duplicate: true });
          continue;
        }
        events.emit({ workspaceId: workspace.id, document: inserted[0] });
        await queue.enqueue(id);
        results.push({ document: toApi(inserted[0], workspace.slug), duplicate: false });
      }
      req.log.info({ workspace: workspace.slug, files: results.length }, 'upload');
      return reply.status(201).send({ data: results });
    },
  );

  app.get(
    '/v1/workspaces/:slug/documents',
    {
      schema: {
        ...common,
        summary: 'List documents, newest first',
        params: SlugParams,
        querystring: DocumentQuery,
        response: { 200: page(Document) },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const where: SQL[] = [eq(documents.workspaceId, workspace.id)];
      if (req.query.status) where.push(eq(documents.status, req.query.status));
      if (req.query.type) where.push(eq(documents.type, req.query.type));
      const rows = await db
        .select()
        .from(documents)
        .where(and(...where))
        .orderBy(desc(documents.id));
      return { data: rows.map((r) => toApi(r, workspace.slug)), nextCursor: null };
    },
  );

  app.get(
    '/v1/workspaces/:slug/documents/events',
    {
      schema: {
        ...common,
        summary: 'Live document status (server-sent events)',
        description:
          'A `text/event-stream`. On connect it sends one `snapshot` event with every unfinished document ' +
          '(queued, transcribing, processing), so a reconnect misses nothing; then a `document` event for each ' +
          'new upload or status change in this workspace, and a `removed` event (`{ id }`) when one is deleted. Browsers should read it with `fetch` (EventSource cannot send the ' +
          '`Authorization` header).',
        params: SlugParams,
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const send = openEventStream(req, reply);
      const res = reply.raw;

      // Subscribe before reading the snapshot, so a change in between is not lost (it may arrive twice).
      const unsubscribe = events.subscribe((e) => {
        if (e.workspaceId !== workspace.id) return;
        if (e.removed) send('removed', { id: e.document.id });
        else send('document', toApi(e.document, workspace.slug));
      });
      const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
      streams.add(res);
      req.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        streams.delete(res);
      });

      try {
        const unfinished = await db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.workspaceId, workspace.id),
              inArray(documents.status, ['queued', 'transcribing', 'processing']),
            ),
          )
          .orderBy(desc(documents.id));
        send('snapshot', { data: unfinished.map((d) => toApi(d, workspace.slug)) });
      } catch (err) {
        // The response is hijacked, so Fastify's error handler can't answer; end the stream
        // and the client reconnects.
        req.log.error({ err }, 'document status snapshot failed');
        res.end();
      }
    },
  );

  app.get(
    '/v1/workspaces/:slug/documents/:documentId',
    { schema: { ...common, summary: 'One document', params: DocParams, response: { 200: Document } } },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      return toApi(await loadDocument(workspace.id, req.params.documentId), workspace.slug);
    },
  );

  app.get(
    '/v1/workspaces/:slug/documents/:documentId/file',
    { schema: { ...common, summary: 'Download the original file', params: DocParams } },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const doc = await loadDocument(workspace.id, req.params.documentId);
      if (!(await storage.exists(doc.storagePath)))
        throw new HttpProblem(404, 'The file is missing from the uploads volume.');
      return reply
        .type(MIME[doc.type])
        .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`)
        .send(createReadStream(storage.absolute(doc.storagePath)));
    },
  );

  app.post(
    '/v1/workspaces/:slug/documents/:documentId/reindex',
    {
      schema: {
        ...common,
        summary: 'Ingest a document again',
        description:
          'Deletes its vectors and runs the ingest flow again with the current settings. Also the way to retry a ' +
          '`failed` document. Returns 202 with the document back in `queued`.',
        params: DocParams,
        response: { 202: Document },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      const doc = await loadDocument(workspace.id, req.params.documentId);
      if (doc.status === 'processing' || doc.status === 'transcribing') {
        throw new HttpProblem(409, 'This document is being ingested right now. Try again when it finishes.');
      }
      const [row] = await db
        .update(documents)
        .set({ status: 'queued', attempts: 0, error: null })
        .where(eq(documents.id, doc.id))
        .returning();
      events.emit({ workspaceId: workspace.id, document: row! });
      await queue.enqueue(doc.id);
      return reply.status(202).send(toApi(row!, workspace.slug));
    },
  );

  app.delete(
    '/v1/workspaces/:slug/documents/:documentId',
    {
      schema: {
        ...common,
        summary: 'Delete a document with its vectors and file',
        params: DocParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      const doc = await loadDocument(workspace.id, req.params.documentId);
      if (doc.status === 'processing' || doc.status === 'transcribing') {
        throw new HttpProblem(409, 'This document is being ingested right now. Try again when it finishes.');
      }
      // Vectors first: if Chroma is down, nothing is deleted and the caller can retry.
      await chroma.deleteDocumentVectors(ChromaService.collectionName(workspace.slug), doc.id);
      await db.delete(documents).where(eq(documents.id, doc.id));
      await storage.remove(doc.storagePath);
      events.emit({ workspaceId: workspace.id, document: doc, removed: true });
      return reply.status(204).send(null);
    },
  );
};
