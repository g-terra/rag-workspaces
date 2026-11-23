import { responseStyles, workspaces, type Database } from '@rag/db';
import { CreateStyle, ResponseStyle, StyleList, StyleSlug, UpdateStyle } from '@rag/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUser, requireAdmin, requireUser } from '../auth/plugin.js';
import { HttpProblem } from '../errors.js';
import { isBuiltIn, listStyles, toApiStyle } from '../services/styles.js';

export type StyleRoutesOptions = { db: Database };

const SlugParams = z.object({ slug: StyleSlug });
const common = { tags: ['styles'], security: [{ bearerAuth: [] }] };

export const styleRoutes: FastifyPluginAsyncZod<StyleRoutesOptions> = async (app, { db }) => {
  app.get(
    '/v1/styles',
    {
      preHandler: requireUser,
      schema: {
        ...common,
        summary: 'List response styles',
        description:
          'The styles an answer or chat reply can be written in: the built-in ones first, then custom ones by name. ' +
          "Pass a slug as `style` when asking, or set it as a workspace's `settings.style`. A style changes tone, " +
          "length and format only; it is added after the workspace's system prompt, so citations and refusals still apply.",
        response: { 200: StyleList },
      },
    },
    async () => ({ data: await listStyles(db) }),
  );

  /** A custom style, or 403 for a built-in one and 404 for none. */
  async function loadCustom(slug: string) {
    if (isBuiltIn(slug)) throw new HttpProblem(403, `"${slug}" is a built-in style and can't be changed.`);
    const [row] = await db.select().from(responseStyles).where(eq(responseStyles.slug, slug));
    if (!row) throw new HttpProblem(404, `No custom style "${slug}".`);
    return row;
  }

  app.post(
    '/v1/styles',
    {
      preHandler: requireAdmin,
      schema: {
        ...common,
        summary: 'Create a custom style (admins)',
        description:
          'Shared by every workspace. The slug never changes and must not be taken, built-in slugs included.',
        body: CreateStyle,
        response: { 201: ResponseStyle },
      },
    },
    async (req, reply) => {
      const admin = currentUser(req);
      const taken = () => new HttpProblem(409, `The style slug "${req.body.slug}" is taken.`);
      if (isBuiltIn(req.body.slug)) throw taken();
      const [row] = await db
        .insert(responseStyles)
        .values({ ...req.body, createdBy: admin.id })
        .onConflictDoNothing()
        .returning();
      if (!row) throw taken();
      return reply.status(201).send(toApiStyle(row));
    },
  );

  app.patch(
    '/v1/styles/:slug',
    {
      preHandler: requireAdmin,
      schema: {
        ...common,
        summary: 'Change a custom style (admins)',
        description:
          'Send only what changes. Built-in styles are `403`. Answers already stored keep the slug only.',
        params: SlugParams,
        body: UpdateStyle,
        response: { 200: ResponseStyle },
      },
    },
    async (req) => {
      const row = await loadCustom(req.params.slug);
      if (!Object.keys(req.body).length) return toApiStyle(row);
      const [updated] = await db
        .update(responseStyles)
        .set(req.body)
        .where(eq(responseStyles.slug, row.slug))
        .returning();
      return toApiStyle(updated!);
    },
  );

  app.delete(
    '/v1/styles/:slug',
    {
      preHandler: requireAdmin,
      schema: {
        ...common,
        summary: 'Delete a custom style (admins)',
        description:
          "`409` while a workspace uses it as its default style: change that workspace's `settings.style` first. " +
          'Stored answers keep the slug.',
        params: SlugParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const row = await loadCustom(req.params.slug);
      const using = await db
        .select({ slug: workspaces.slug })
        .from(workspaces)
        .where(sql`${workspaces.settings}->>'style' = ${row.slug}`);
      if (using.length) {
        throw new HttpProblem(
          409,
          `Workspaces use "${row.slug}" as their default style: ${using.map((w) => w.slug).join(', ')}.`,
        );
      }
      await db.delete(responseStyles).where(eq(responseStyles.slug, row.slug));
      return reply.status(204).send(null);
    },
  );
};
