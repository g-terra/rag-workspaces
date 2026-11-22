import {
  apiKeys,
  apiKeyWorkspaces,
  newId,
  workspaces,
  type ApiKey as ApiKeyRow,
  type Database,
} from '@rag/db';
import { ApiKey, CreateApiKey, CreatedApiKey, UpdateApiKey, page } from '@rag/shared';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { generateSecret } from '../auth/api-keys.js';
import { currentUser, requireAdmin } from '../auth/plugin.js';
import { HttpProblem } from '../errors.js';

const KeyParams = z.object({ keyId: z.string() });
const common = { tags: ['api-keys'], security: [{ bearerAuth: [] }] };

/** Admin-only management of API keys (docs/api-schema.md, "API keys and identity"). */
export const apiKeyRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.addHook('preHandler', requireAdmin);

  /** Workspace ids for the given slugs; 422 naming any that do not exist. */
  async function resolveWorkspaces(slugs: string[]) {
    const unique = [...new Set(slugs)];
    const rows = await db
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(inArray(workspaces.slug, unique));
    const missing = unique.filter((s) => !rows.some((r) => r.slug === s));
    if (missing.length) throw new HttpProblem(422, `No such workspace: ${missing.join(', ')}`);
    return rows;
  }

  async function slugsFor(keyIds: string[]) {
    if (!keyIds.length) return new Map<string, string[]>();
    const rows = await db
      .select({ keyId: apiKeyWorkspaces.apiKeyId, slug: workspaces.slug })
      .from(apiKeyWorkspaces)
      .innerJoin(workspaces, eq(workspaces.id, apiKeyWorkspaces.workspaceId))
      .where(inArray(apiKeyWorkspaces.apiKeyId, keyIds))
      .orderBy(asc(workspaces.slug));
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.keyId, [...(map.get(r.keyId) ?? []), r.slug]);
    return map;
  }

  const toApi = (k: ApiKeyRow, slugs: string[]): ApiKey => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    role: k.role,
    workspaces: slugs,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  });

  async function load(keyId: string) {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId));
    if (!row) throw new HttpProblem(404, `No API key ${keyId}`);
    return row;
  }

  app.get(
    '/v1/api-keys',
    { schema: { ...common, summary: 'List API keys, newest first', response: { 200: page(ApiKey) } } },
    async () => {
      const rows = await db.select().from(apiKeys).orderBy(desc(apiKeys.id));
      const slugs = await slugsFor(rows.map((r) => r.id));
      return { data: rows.map((r) => toApi(r, slugs.get(r.id) ?? [])), nextCursor: null };
    },
  );

  app.post(
    '/v1/api-keys',
    {
      schema: {
        ...common,
        summary: 'Create an API key',
        description:
          'The response holds the secret. It is shown once and cannot be recovered; only a hash is stored.',
        body: CreateApiKey,
        response: { 201: CreatedApiKey },
      },
    },
    async (req, reply) => {
      const admin = currentUser(req);
      const ws = await resolveWorkspaces(req.body.workspaces);
      const { secret, prefix, hash } = generateSecret();
      const id = newId('apiKey');
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(apiKeys)
          .values({
            id,
            name: req.body.name,
            prefix,
            secretHash: hash,
            role: req.body.role,
            createdBy: admin.id,
            expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
          })
          .returning();
        await tx.insert(apiKeyWorkspaces).values(ws.map((w) => ({ apiKeyId: id, workspaceId: w.id })));
        return created!;
      });
      req.log.info({ apiKeyId: id, by: admin.id }, 'API key created');
      return reply.status(201).send({ ...toApi(row, ws.map((w) => w.slug).sort()), secret });
    },
  );

  app.get(
    '/v1/api-keys/:keyId',
    { schema: { ...common, summary: 'One API key', params: KeyParams, response: { 200: ApiKey } } },
    async (req) => {
      const row = await load(req.params.keyId);
      return toApi(row, (await slugsFor([row.id])).get(row.id) ?? []);
    },
  );

  app.patch(
    '/v1/api-keys/:keyId',
    {
      schema: {
        ...common,
        summary: 'Rename, change workspaces or expiry',
        description:
          'The role cannot change: create a new key instead, so a key never gains rights silently.',
        params: KeyParams,
        body: UpdateApiKey,
        response: { 200: ApiKey },
      },
    },
    async (req) => {
      const row = await load(req.params.keyId);
      if (row.revokedAt) throw new HttpProblem(409, 'This key is revoked.');
      const ws = req.body.workspaces ? await resolveWorkspaces(req.body.workspaces) : undefined;
      await db.transaction(async (tx) => {
        const set: Partial<typeof apiKeys.$inferInsert> = {};
        if (req.body.name !== undefined) set.name = req.body.name;
        if (req.body.expiresAt !== undefined)
          set.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
        if (Object.keys(set).length) await tx.update(apiKeys).set(set).where(eq(apiKeys.id, row.id));
        if (ws) {
          await tx.delete(apiKeyWorkspaces).where(eq(apiKeyWorkspaces.apiKeyId, row.id));
          await tx.insert(apiKeyWorkspaces).values(ws.map((w) => ({ apiKeyId: row.id, workspaceId: w.id })));
        }
      });
      const updated = await load(row.id);
      return toApi(updated, (await slugsFor([row.id])).get(row.id) ?? []);
    },
  );

  app.delete(
    '/v1/api-keys/:keyId',
    {
      schema: {
        ...common,
        summary: 'Revoke an API key',
        description:
          'The key stops working at once. It stays listed (with `revokedAt`) so usage history keeps its name.',
        params: KeyParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const row = await load(req.params.keyId);
      if (!row.revokedAt) {
        await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, row.id));
        req.log.info({ apiKeyId: row.id, by: req.principal?.id }, 'API key revoked');
      }
      return reply.status(204).send(null);
    },
  );
};
