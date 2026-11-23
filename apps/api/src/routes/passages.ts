import { documents, type Database, type Document as DocumentRow, type Workspace } from '@rag/db';
import type { LangflowClient } from '@rag/langflow-client';
import {
  DocumentPassagesQuery,
  Passage,
  PassageSearch,
  PassageSearchResult,
  PassageWithNeighbours,
  WorkspaceSlug,
  page,
} from '@rag/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireWorkspace } from '../auth/access.js';
import { requireFolder } from '../services/folders.js';
import { assertSearchable } from '../services/reindex.js';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import { ChromaService, type StoredChunk } from '../services/chroma.js';
import { flowProblem } from '../services/flow-errors.js';
import { parsePassageId, passageId, resolveHits, retrieve, vectorId } from '../services/passages.js';

export type PassageRoutesOptions = {
  db: Database;
  chroma: ChromaService;
  langflow: LangflowClient;
  config: Pick<
    Config,
    | 'DEFAULT_TOP_K'
    | 'DEFAULT_MIN_SCORE'
    | 'RETRIEVE_TIMEOUT_MS'
    | 'LMSTUDIO_BASE_URL'
    | 'OPENAI_API_KEY'
    | 'GEMINI_API_KEY'
  >;
};

const SlugParams = z.object({ slug: WorkspaceSlug });
const common = { tags: ['passages'], security: [{ bearerAuth: [] }] };

/** A stored chunk as a passage. `page` is only kept when it is a real page number. */
function fromChunk(chunk: StoredChunk, document: Pick<DocumentRow, 'id' | 'title'>): Passage {
  const index = Number(chunk.metadata.chunk_index ?? chunk.id.split(':').pop());
  const page = chunk.metadata.page;
  return {
    id: passageId(document.id, index),
    documentId: document.id,
    documentTitle: document.title,
    page: typeof page === 'number' && Number.isInteger(page) ? page : null,
    chunkIndex: index,
    text: chunk.text,
  };
}

export const passageRoutes: FastifyPluginAsyncZod<PassageRoutesOptions> = async (app, opts) => {
  const { db, chroma, langflow, config } = opts;

  async function loadDocument(workspace: Workspace, documentId: string) {
    const [row] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.workspaceId, workspace.id), eq(documents.id, documentId)));
    return row;
  }

  app.get(
    '/v1/workspaces/:slug/passages',
    {
      config: { modelCall: true },
      schema: {
        ...common,
        summary: 'Search passages',
        description:
          'The passages that best match a query, best first, with their cosine similarity. ' +
          'No AI answer: use this to see what an answer would be based on, or to build your own prompt.',
        params: SlugParams,
        querystring: PassageSearch,
        response: { 200: PassageSearchResult },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      assertSearchable(workspace);
      const { query, limit, minScore } = req.query;
      const folderId = req.query.folderId && (await requireFolder(db, workspace.id, req.query.folderId));
      req.usage = { question: query };
      let hits;
      try {
        hits = await retrieve(langflow, workspace, query, config, { limit, minScore, folderId });
      } catch (err) {
        throw flowProblem(err, 'Search');
      }

      const data = await resolveHits(db, workspace.id, hits);
      return { data };
    },
  );

  app.get(
    '/v1/workspaces/:slug/passages/:passageId',
    {
      schema: {
        ...common,
        summary: 'Get a passage',
        description:
          'One passage with the passages just before and after it in its document (for a citation preview).',
        params: SlugParams.extend({ passageId: z.string() }),
        response: { 200: PassageWithNeighbours },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      assertSearchable(workspace);
      const parsed = parsePassageId(req.params.passageId);
      const document = parsed && (await loadDocument(workspace, parsed.documentId));
      if (!parsed || !document || document.status !== 'ready')
        throw new HttpProblem(404, `No passage ${req.params.passageId}`);

      const i = parsed.chunkIndex;
      const wanted = [i - 1, i, i + 1].filter((n) => n >= 0).map((n) => vectorId(document.id, n));
      const chunks = await chroma.getChunks(ChromaService.collectionName(workspace.slug), wanted);
      const byIndex = new Map(chunks.map((c) => [fromChunk(c, document).chunkIndex, fromChunk(c, document)]));
      const passage = byIndex.get(i);
      if (!passage) throw new HttpProblem(404, `No passage ${req.params.passageId}`);
      return { passage, previous: byIndex.get(i - 1) ?? null, next: byIndex.get(i + 1) ?? null };
    },
  );

  app.get(
    '/v1/workspaces/:slug/documents/:documentId/passages',
    {
      schema: {
        ...common,
        summary: "List a document's passages",
        description:
          'The passages of one document in reading order, a page at a time. Empty until the document is ready.',
        params: SlugParams.extend({ documentId: z.string() }),
        querystring: DocumentPassagesQuery,
        response: { 200: page(Passage) },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      assertSearchable(workspace);
      const document = await loadDocument(workspace, req.params.documentId);
      if (!document) throw new HttpProblem(404, `No document ${req.params.documentId}`);

      // Chunk ids are `<document id>:0 … :n-1`, so a page is a range of ids and the cursor is an offset.
      const total = document.status === 'ready' ? (document.passageCount ?? 0) : 0;
      const offset = Number(req.query.cursor ?? 0);
      const end = Math.min(offset + req.query.limit, total);
      const ids = [];
      for (let n = offset; n < end; n++) ids.push(vectorId(document.id, n));
      const chunks = await chroma.getChunks(ChromaService.collectionName(workspace.slug), ids);
      const data = chunks.map((c) => fromChunk(c, document)).sort((a, b) => a.chunkIndex - b.chunkIndex);
      return { data, nextCursor: end < total ? String(end) : null };
    },
  );
};
