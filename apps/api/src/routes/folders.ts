import { documents, folders, newId, type Database, type Folder as FolderRow } from '@rag/db';
import { Folder, FolderInput, WorkspaceSlug, page } from '@rag/shared';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireWorkspace } from '../auth/access.js';
import { standardOnly } from '../services/composites.js';
import { HttpProblem } from '../errors.js';
import { ChromaService } from '../services/chroma.js';
import type { DocumentEvents } from '../services/document-events.js';

export type FolderRoutesOptions = { db: Database; chroma: ChromaService; events: DocumentEvents };

const SlugParams = z.object({ slug: WorkspaceSlug });
const FolderParams = SlugParams.extend({ folderId: z.string() });
const common = { tags: ['documents'], security: [{ bearerAuth: [] }] };

/**
 * Folders group documents inside a workspace (docs/architecture.md, "Workspaces"). Flat, unique
 * names ignoring case. Deleting one moves its documents, and their passages, to the top level.
 */
export const folderRoutes: FastifyPluginAsyncZod<FolderRoutesOptions> = async (
  app,
  { db, chroma, events },
) => {
  // A composite has no folders: its sources do.
  app.addHook('preHandler', standardOnly(db));
  const toApi = (f: FolderRow, slug: string, documentCount: number): Folder => ({
    id: f.id,
    workspace: slug,
    name: f.name,
    documentCount,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  });

  async function documentCount(folderId: string) {
    const [row] = await db.select({ n: count() }).from(documents).where(eq(documents.folderId, folderId));
    return row?.n ?? 0;
  }

  async function loadFolder(workspaceId: string, folderId: string) {
    const [row] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.workspaceId, workspaceId), eq(folders.id, folderId)));
    if (!row) throw new HttpProblem(404, `No folder ${folderId} in this workspace`);
    return row;
  }

  /** Names are unique per workspace, ignoring case (`folders_workspace_name_key`). */
  async function nameTaken<T>(name: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
      if (code === '23505') throw new HttpProblem(409, `There is already a folder called "${name}".`);
      throw err;
    }
  }

  app.get(
    '/v1/workspaces/:slug/folders',
    {
      schema: {
        ...common,
        summary: 'List folders, by name',
        params: SlugParams,
        response: { 200: page(Folder) },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const rows = await db
        .select({ folder: folders, n: count(documents.id) })
        .from(folders)
        .leftJoin(documents, eq(documents.folderId, folders.id))
        .where(eq(folders.workspaceId, workspace.id))
        .groupBy(folders.id)
        .orderBy(asc(folders.name));
      return { data: rows.map((r) => toApi(r.folder, workspace.slug, r.n)), nextCursor: null };
    },
  );

  app.post(
    '/v1/workspaces/:slug/folders',
    {
      schema: {
        ...common,
        summary: 'Create a folder',
        description: '`409` when the workspace already has a folder with that name (ignoring case).',
        params: SlugParams,
        body: FolderInput,
        response: { 201: Folder },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      const [row] = await nameTaken(req.body.name, () =>
        db
          .insert(folders)
          .values({ id: newId('folder'), workspaceId: workspace.id, name: req.body.name })
          .returning(),
      );
      return reply.status(201).send(toApi(row!, workspace.slug, 0));
    },
  );

  app.patch(
    '/v1/workspaces/:slug/folders/:folderId',
    {
      schema: {
        ...common,
        summary: 'Rename a folder',
        description: 'Passages keep the folder id, so nothing is reindexed. `409` for a name already in use.',
        params: FolderParams,
        body: FolderInput,
        response: { 200: Folder },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      const folder = await loadFolder(workspace.id, req.params.folderId);
      const [row] = await nameTaken(req.body.name, () =>
        db.update(folders).set({ name: req.body.name }).where(eq(folders.id, folder.id)).returning(),
      );
      return toApi(row!, workspace.slug, await documentCount(folder.id));
    },
  );

  app.delete(
    '/v1/workspaces/:slug/folders/:folderId',
    {
      schema: {
        ...common,
        summary: 'Delete a folder; its documents move to the top level',
        description:
          'Documents are kept, with their passages. `409` while one of them is being ingested; `503` when the ' +
          'vector store cannot be updated (nothing is deleted, try again).',
        params: FolderParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      const folder = await loadFolder(workspace.id, req.params.folderId);
      const inside = await db.select().from(documents).where(eq(documents.folderId, folder.id));
      if (inside.some((d) => d.status === 'processing' || d.status === 'transcribing')) {
        throw new HttpProblem(
          409,
          'A document in this folder is being ingested. Try again when it finishes.',
        );
      }
      // Passages first: if Chroma fails part way, the folder is still there and a retry finishes the job.
      const collection = ChromaService.collectionName(workspace.slug);
      try {
        for (const d of inside) await chroma.setDocumentFolder(collection, d.id, null);
      } catch (err) {
        req.log.error({ err, folderId: folder.id }, 'moving passages out of a deleted folder failed');
        throw new HttpProblem(503, 'The vector store could not be updated, so the folder was not deleted.');
      }
      // The foreign key sets folder_id to null on the documents.
      await db.delete(folders).where(eq(folders.id, folder.id));
      if (inside.length) {
        const moved = await db
          .select()
          .from(documents)
          .where(
            inArray(
              documents.id,
              inside.map((d) => d.id),
            ),
          );
        for (const d of moved) events.emit({ workspaceId: workspace.id, document: d });
      }
      return reply.status(204).send(null);
    },
  );
};
