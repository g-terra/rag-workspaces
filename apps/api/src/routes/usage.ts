import type { Database } from '@rag/db';
import {
  RequestLogEntry,
  RequestLogQuery,
  Timeseries,
  TimeseriesQuery,
  TopDocuments,
  TopQuery,
  TopQuestions,
  UsageRange,
  UsageSummary,
  WorkspaceSlug,
  page,
} from '@rag/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireWorkspace } from '../auth/access.js';
import { requireAdmin } from '../auth/plugin.js';
import {
  rangeOf,
  requestLog,
  summary,
  timeseries,
  topDocuments,
  topQuestions,
  type Scope,
} from '../services/analytics.js';

const common = { tags: ['usage'], security: [{ bearerAuth: [] }] };

/**
 * The same analytics twice: across everything at `/v1/usage` (admins), and for one
 * workspace at `/v1/workspaces/{slug}/usage` (its editors and admins).
 */
export const usageRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  const variants = [
    {
      prefix: '/v1/usage',
      who: 'Admins only; covers every workspace, including deleted ones.',
      params: undefined,
      scope: async (req: FastifyRequest, reply: FastifyReply): Promise<Scope> => {
        await requireAdmin(req, reply);
        return {};
      },
    },
    {
      prefix: '/v1/workspaces/:slug/usage',
      who: "The workspace's editors and admins.",
      params: z.object({ slug: WorkspaceSlug }),
      scope: async (req: FastifyRequest, _reply: FastifyReply): Promise<Scope> => {
        const { slug } = req.params as { slug: string };
        const { workspace } = await requireWorkspace(db, req.principal, slug, 'editor');
        return { workspaceId: workspace.id };
      },
    },
  ];

  for (const v of variants) {
    const params = v.params ? { params: v.params } : {};

    app.get(
      `${v.prefix}/summary`,
      {
        schema: {
          ...common,
          ...params,
          summary: 'Usage summary',
          description: `Requests, error rate, latency percentiles, questions, tokens and feedback in a time range (default: the last 7 days). ${v.who}`,
          querystring: UsageRange,
          response: { 200: UsageSummary },
        },
      },
      async (req, reply) => summary(db, await v.scope(req, reply), rangeOf(req.query)),
    );

    app.get(
      `${v.prefix}/timeseries`,
      {
        schema: {
          ...common,
          ...params,
          summary: 'Usage over time',
          description: `Requests, server errors and latency per hour or day (UTC), optionally per route, API key, user or workspace. ${v.who}`,
          querystring: TimeseriesQuery,
          response: { 200: Timeseries },
        },
      },
      async (req, reply) => ({
        data: await timeseries(
          db,
          await v.scope(req, reply),
          rangeOf(req.query),
          req.query.interval,
          req.query.groupBy,
        ),
      }),
    );

    app.get(
      `${v.prefix}/top-questions`,
      {
        schema: {
          ...common,
          ...params,
          summary: 'Most asked questions',
          description: `Answers and chat messages, grouped ignoring case. Questions older than the retention period no longer count. ${v.who}`,
          querystring: TopQuery,
          response: { 200: TopQuestions },
        },
      },
      async (req, reply) => ({
        data: await topQuestions(db, await v.scope(req, reply), rangeOf(req.query), req.query.limit),
      }),
    );

    app.get(
      `${v.prefix}/top-documents`,
      {
        schema: {
          ...common,
          ...params,
          summary: 'Most cited documents',
          description: `How often each document was among the passages given to the model. ${v.who}`,
          querystring: TopQuery,
          response: { 200: TopDocuments },
        },
      },
      async (req, reply) => ({
        data: await topDocuments(db, await v.scope(req, reply), rangeOf(req.query), req.query.limit),
      }),
    );

    app.get(
      `${v.prefix}/requests`,
      {
        schema: {
          ...common,
          ...params,
          summary: 'Request log',
          description: `Every logged request, newest first, filterable by route pattern, status, API key or user. ${v.who}`,
          querystring: RequestLogQuery,
          response: { 200: page(RequestLogEntry) },
        },
      },
      async (req, reply) => requestLog(db, await v.scope(req, reply), rangeOf(req.query), req.query),
    );
  }
};
