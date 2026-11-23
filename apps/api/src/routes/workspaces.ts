import {
  apiKeys,
  apiKeyWorkspaces,
  compositeSources,
  newId,
  workspaceMembers,
  workspaces,
  type Database,
  type Workspace as WorkspaceRow,
} from '@rag/db';
import type { WorkspaceSettings } from '@rag/shared';
import {
  CreateWorkspace,
  GrantMember,
  ReindexWorkspace,
  UpdateWorkspace,
  Workspace,
  WorkspaceMember,
  WorkspaceSlug,
  page,
} from '@rag/shared';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { accessTo, requireWorkspace, type Access } from '../auth/access.js';
import { currentUser, requireAdmin, requireUser } from '../auth/plugin.js';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import { ChromaService } from '../services/chroma.js';
import type { DocumentEvents } from '../services/document-events.js';
import type { IngestQueue } from '../services/ingest-queue.js';
import { startReindex } from '../services/reindex.js';
import { requireStandard, setSources, sourcesOf } from '../services/composites.js';
import { embeddingPrefixes } from '../services/providers.js';
import type { UploadStorage } from '../services/storage.js';
import { findStyle } from '../services/styles.js';

export type WorkspaceRoutesOptions = {
  db: Database;
  chroma: ChromaService;
  storage: UploadStorage;
  queue: IngestQueue;
  events: DocumentEvents;
  config: Pick<
    Config,
    | 'DEFAULT_EMBEDDING_PROVIDER'
    | 'DEFAULT_EMBEDDING_MODEL'
    | 'EMBEDDING_PREFIXES'
    | 'LMSTUDIO_BASE_URL'
    | 'OPENAI_API_KEY'
    | 'GEMINI_API_KEY'
  >;
};

const SlugParams = z.object({ slug: WorkspaceSlug });
const MemberParams = SlugParams.extend({ userId: z.string().min(1).max(100) });
const common = { tags: ['workspaces'], security: [{ bearerAuth: [] }] };

const UNSET: WorkspaceSettings = {
  embeddingProvider: null,
  embeddingModel: null,
  embeddingPrefixes: null,
  chatProvider: null,
  chatModel: null,
  systemPrompt: null,
  chunkSize: null,
  chunkOverlap: null,
  topK: null,
  minScore: null,
  reasoningEffort: null,
  style: null,
};

export const workspaceRoutes: FastifyPluginAsyncZod<WorkspaceRoutesOptions> = async (
  app,
  { db, chroma, storage, queue, events, config },
) => {
  const toApi = (w: WorkspaceRow, access: Access, sources: WorkspaceRow[]): Workspace => ({
    id: w.id,
    slug: w.slug,
    name: w.name,
    description: w.description,
    kind: w.kind,
    sources: w.kind === 'composite' ? sources.map((s) => s.slug) : null,
    status: w.status,
    settings: { ...UNSET, ...w.settings } as WorkspaceSettings,
    access,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  });

  app.get(
    '/v1/workspaces',
    {
      preHandler: requireUser,
      schema: { ...common, summary: 'Workspaces the caller can see', response: { 200: page(Workspace) } },
    },
    async (req) => {
      const p = req.principal!;
      const rows = await db.select().from(workspaces).orderBy(asc(workspaces.slug));
      const links = await db.select().from(compositeSources).orderBy(asc(compositeSources.position));
      const byId = new Map(rows.map((w) => [w.id, w]));
      const visible = [];
      for (const w of rows) {
        const access = await accessTo(db, p, w);
        // A link read after its source was deleted (two separate reads) is skipped, not a crash.
        const sources = links.flatMap((l) => {
          const source = l.compositeId === w.id ? byId.get(l.sourceId) : undefined;
          return source ? [source] : [];
        });
        if (access) visible.push(toApi(w, access, sources));
      }
      return { data: visible, nextCursor: null };
    },
  );

  app.post(
    '/v1/workspaces',
    {
      preHandler: requireAdmin,
      schema: {
        ...common,
        summary: 'Create a workspace',
        description:
          'Creates the workspace and its Chroma collection (`ws_<slug>`). The slug never changes. ' +
          'The embedding provider and model are pinned now, from the request or the defaults in `.env`. ' +
          'With `kind: "composite"` and `sources` (two to ten standard workspaces) it holds no documents and ' +
          'no collection, and answers from its sources instead; embedding, chunking and `minScore` are theirs.',
        body: CreateWorkspace,
        response: { 201: Workspace },
      },
    },
    async (req, reply) => {
      const admin = currentUser(req);
      const { slug, name, description, kind = 'standard', sources, settings = {} } = req.body;
      if (settings.style) findStyle(settings.style);
      const [taken] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slug));
      if (taken) throw new HttpProblem(409, `The slug "${slug}" is taken.`);
      const composite = kind === 'composite';
      const embeddingModel = () => settings.embeddingModel ?? config.DEFAULT_EMBEDDING_MODEL;
      const pinned = composite
        ? settings
        : {
            ...settings,
            embeddingProvider: settings.embeddingProvider ?? config.DEFAULT_EMBEDDING_PROVIDER,
            embeddingModel: embeddingModel(),
            embeddingPrefixes: embeddingPrefixes(embeddingModel(), config),
          };
      // Collection first: if Chroma is down nothing is half-created in Postgres. A composite has none.
      if (!composite) await chroma.ensureCollection(ChromaService.collectionName(slug));
      const created = await db
        .transaction(async (tx) => {
          const [row] = await tx
            .insert(workspaces)
            .values({
              id: newId('workspace'),
              slug,
              name,
              kind,
              description: description ?? null,
              settings: pinned as WorkspaceRow['settings'],
            })
            .returning();
          if (composite) await setSources(tx, row!, sources!);
          return { row: row!, sources: await sourcesOf(tx, row!) };
        })
        .catch((err: unknown) => {
          // Two creates racing for one slug: the second loses at the unique index.
          if (
            (err as { cause?: { code?: string } }).cause?.code === '23505' ||
            (err as { code?: string }).code === '23505'
          )
            throw new HttpProblem(409, `The slug "${slug}" is taken.`);
          throw err;
        });
      req.log.info({ workspace: slug, kind, by: admin.id }, 'workspace created');
      return reply.status(201).send(toApi(created.row, 'admin', created.sources));
    },
  );

  app.get(
    '/v1/workspaces/:slug',
    { schema: { ...common, summary: 'One workspace', params: SlugParams, response: { 200: Workspace } } },
    async (req) => {
      const { workspace, access } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      return toApi(workspace, access, await sourcesOf(db, workspace));
    },
  );

  app.patch(
    '/v1/workspaces/:slug',
    {
      schema: {
        ...common,
        summary: 'Update name, description or settings',
        description:
          'Settings are merged: send only what changes; `null` returns a setting to the global default. ' +
          "`sources` replaces a composite's sources (refused for a standard workspace, and so are chunking " +
          'and `minScore` for a composite).',
        params: SlugParams,
        body: UpdateWorkspace,
        response: { 200: Workspace },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      const { sources, settings } = req.body;
      if (settings?.style) findStyle(settings.style);
      if (workspace.kind === 'standard' && sources)
        throw new HttpProblem(
          400,
          `"${workspace.slug}" is a standard workspace: only a composite has sources.`,
        );
      const own = (['chunkSize', 'chunkOverlap', 'minScore'] as const).find(
        (k) => workspace.kind === 'composite' && settings?.[k] != null,
      );
      if (own) throw new HttpProblem(400, `A composite has no ${own}: each source uses its own.`);
      const set: Partial<typeof workspaces.$inferInsert> = {};
      if (req.body.name !== undefined) set.name = req.body.name;
      if (req.body.description !== undefined) set.description = req.body.description;
      if (settings) set.settings = { ...workspace.settings, ...settings };
      if (sources) set.updatedAt = new Date();
      return db.transaction(async (tx) => {
        const [row] = Object.keys(set).length
          ? await tx.update(workspaces).set(set).where(eq(workspaces.id, workspace.id)).returning()
          : [workspace];
        if (sources) await setSources(tx, workspace, sources);
        return toApi(row!, 'admin', await sourcesOf(tx, row!));
      });
    },
  );

  app.post(
    '/v1/workspaces/:slug/reindex',
    {
      schema: {
        ...common,
        summary: 'Ingest every document again, optionally with a new embedding model',
        description:
          'Empties the Chroma collection and queues every document. The workspace is `reindexing` until the ' +
          'last document is `ready` or `failed`; meanwhile passages, answers and chat messages answer 503 with ' +
          '`Retry-After`. Send `embeddingProvider` and `embeddingModel` to switch the workspace to another ' +
          'model (the only way to change it); an empty body reindexes with the current settings, for example ' +
          'after changing chunking. `409` while a reindex is running, `422` for a provider whose key is not set.',
        params: SlugParams,
        // No body at all reaches the schema as null.
        body: ReindexWorkspace.nullish(),
        response: { 202: Workspace },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      requireStandard(workspace);
      const row = await startReindex({ db, chroma, queue, events, config }, workspace, req.body ?? {});
      req.log.info(
        { workspace: workspace.slug, by: req.principal?.id, embeddingModel: row.settings.embeddingModel },
        'workspace reindex started',
      );
      return reply.status(202).send(toApi(row, 'admin', []));
    },
  );

  app.delete(
    '/v1/workspaces/:slug',
    {
      schema: {
        ...common,
        summary: 'Delete a workspace and all its data',
        description:
          'Removes its documents, files, Chroma collection, members and key bindings. An API key left with no workspace is revoked.',
        params: SlugParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      await db.transaction(async (tx) => {
        // Keys bound to this workspace only would be left with nothing: revoke them.
        const bound = await tx
          .select({ id: apiKeyWorkspaces.apiKeyId })
          .from(apiKeyWorkspaces)
          .where(eq(apiKeyWorkspaces.workspaceId, workspace.id));
        const ids = bound.map((b) => b.id);
        const counts = ids.length
          ? await tx
              .select({ id: apiKeyWorkspaces.apiKeyId, n: count() })
              .from(apiKeyWorkspaces)
              .where(inArray(apiKeyWorkspaces.apiKeyId, ids))
              .groupBy(apiKeyWorkspaces.apiKeyId)
          : [];
        const orphaned = counts.filter((c) => c.n === 1).map((c) => c.id);
        if (orphaned.length) {
          await tx
            .update(apiKeys)
            .set({ revokedAt: new Date() })
            .where(and(inArray(apiKeys.id, orphaned), isNull(apiKeys.revokedAt)));
        }
        await tx.delete(workspaces).where(eq(workspaces.id, workspace.id));
      });
      if (workspace.kind === 'standard') {
        try {
          await chroma.deleteCollection(ChromaService.collectionName(workspace.slug));
        } catch (err) {
          // The workspace is gone either way; a leftover collection is harmless and `pnpm doctor` reports it.
          req.log.warn({ err, workspace: workspace.slug }, 'could not delete the Chroma collection');
        }
        await storage.removeWorkspace(workspace.slug);
      }
      req.log.info({ workspace: workspace.slug, by: req.principal?.id }, 'workspace deleted');
      return reply.status(204).send(null);
    },
  );

  // --- members -------------------------------------------------------------------------------------

  const memberToApi = (m: typeof workspaceMembers.$inferSelect): WorkspaceMember => ({
    userId: m.userId,
    role: m.role,
    grantedBy: m.grantedBy,
    createdAt: m.createdAt.toISOString(),
  });

  app.get(
    '/v1/workspaces/:slug/members',
    {
      schema: {
        ...common,
        summary: 'People with access and their role',
        description: 'Admins have access to every workspace without being listed.',
        params: SlugParams,
        response: { 200: page(WorkspaceMember) },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      const rows = await db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspace.id))
        .orderBy(asc(workspaceMembers.createdAt));
      return { data: rows.map(memberToApi), nextCursor: null };
    },
  );

  app.put(
    '/v1/workspaces/:slug/members/:userId',
    {
      preHandler: requireUser,
      schema: {
        ...common,
        summary: "Grant or change a person's access",
        description: 'The user id is the Keycloak user id. The person does not need to have signed in yet.',
        params: MemberParams,
        body: GrantMember,
        response: { 200: WorkspaceMember },
      },
    },
    async (req) => {
      const admin = currentUser(req);
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      const [row] = await db
        .insert(workspaceMembers)
        .values({
          workspaceId: workspace.id,
          userId: req.params.userId,
          role: req.body.role,
          grantedBy: admin.id,
        })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role: req.body.role, grantedBy: admin.id },
        })
        .returning();
      return memberToApi(row!);
    },
  );

  app.delete(
    '/v1/workspaces/:slug/members/:userId',
    {
      schema: {
        ...common,
        summary: "Remove a person's access",
        params: MemberParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      await db
        .delete(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, req.params.userId)),
        );
      return reply.status(204).send(null);
    },
  );
};
