import {
  apiKeys,
  apiKeyWorkspaces,
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

export type WorkspaceRoutesOptions = {
  db: Database;
  chroma: ChromaService;
  config: Pick<Config, 'DEFAULT_EMBEDDING_PROVIDER' | 'DEFAULT_EMBEDDING_MODEL'>;
};

const SlugParams = z.object({ slug: WorkspaceSlug });
const MemberParams = SlugParams.extend({ userId: z.string().min(1).max(100) });
const common = { tags: ['workspaces'], security: [{ bearerAuth: [] }] };

const UNSET: Omit<WorkspaceSettings, 'embeddingProvider' | 'embeddingModel'> = {
  chatProvider: null,
  chatModel: null,
  systemPrompt: null,
  chunkSize: null,
  chunkOverlap: null,
  topK: null,
  minScore: null,
};

export const workspaceRoutes: FastifyPluginAsyncZod<WorkspaceRoutesOptions> = async (
  app,
  { db, chroma, config },
) => {
  const toApi = (w: WorkspaceRow, access: Access): Workspace => ({
    id: w.id,
    slug: w.slug,
    name: w.name,
    description: w.description,
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
      const visible = [];
      for (const w of rows) {
        const access = await accessTo(db, p, w);
        if (access) visible.push(toApi(w, access));
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
          'The embedding provider and model are pinned now, from the request or the defaults in `.env`.',
        body: CreateWorkspace,
        response: { 201: Workspace },
      },
    },
    async (req, reply) => {
      const admin = currentUser(req);
      const { slug, name, description, settings = {} } = req.body;
      const [taken] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slug));
      if (taken) throw new HttpProblem(409, `The slug "${slug}" is taken.`);
      const pinned = {
        ...settings,
        embeddingProvider: settings.embeddingProvider ?? config.DEFAULT_EMBEDDING_PROVIDER,
        embeddingModel: settings.embeddingModel ?? config.DEFAULT_EMBEDDING_MODEL,
      };
      // Collection first: if Chroma is down nothing is half-created in Postgres.
      await chroma.ensureCollection(ChromaService.collectionName(slug));
      const [row] = await db
        .insert(workspaces)
        .values({ id: newId('workspace'), slug, name, description: description ?? null, settings: pinned })
        .returning()
        .catch((err: unknown) => {
          // Two creates racing for one slug: the second loses at the unique index.
          if (
            (err as { cause?: { code?: string } }).cause?.code === '23505' ||
            (err as { code?: string }).code === '23505'
          )
            throw new HttpProblem(409, `The slug "${slug}" is taken.`);
          throw err;
        });
      req.log.info({ workspace: slug, by: admin.id }, 'workspace created');
      return reply.status(201).send(toApi(row!, 'admin'));
    },
  );

  app.get(
    '/v1/workspaces/:slug',
    { schema: { ...common, summary: 'One workspace', params: SlugParams, response: { 200: Workspace } } },
    async (req) => {
      const { workspace, access } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      return toApi(workspace, access);
    },
  );

  app.patch(
    '/v1/workspaces/:slug',
    {
      schema: {
        ...common,
        summary: 'Update name, description or settings',
        description:
          'Settings are merged: send only what changes; `null` returns a setting to the global default.',
        params: SlugParams,
        body: UpdateWorkspace,
        response: { 200: Workspace },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      const set: Partial<typeof workspaces.$inferInsert> = {};
      if (req.body.name !== undefined) set.name = req.body.name;
      if (req.body.description !== undefined) set.description = req.body.description;
      if (req.body.settings) set.settings = { ...workspace.settings, ...req.body.settings };
      const [row] = Object.keys(set).length
        ? await db.update(workspaces).set(set).where(eq(workspaces.id, workspace.id)).returning()
        : [workspace];
      return toApi(row!, 'admin');
    },
  );

  app.delete(
    '/v1/workspaces/:slug',
    {
      schema: {
        ...common,
        summary: 'Delete a workspace and all its data',
        description:
          'Removes its Chroma collection, members and key bindings. An API key left with no workspace is revoked.',
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
      try {
        await chroma.deleteCollection(ChromaService.collectionName(workspace.slug));
      } catch (err) {
        // The workspace is gone either way; a leftover collection is harmless and `pnpm doctor` reports it.
        req.log.warn({ err, workspace: workspace.slug }, 'could not delete the Chroma collection');
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
