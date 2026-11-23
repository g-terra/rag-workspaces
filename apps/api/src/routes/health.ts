import { Health, Ready } from '@rag/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { runChecks, type ReadinessCheck } from '../readiness.js';

export type HealthRoutesOptions = { checks: ReadinessCheck[]; timeoutMs: number };

export const healthRoutes: FastifyPluginAsyncZod<HealthRoutesOptions> = async (app, opts) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness: the API process is up',
        response: { 200: Health },
      },
      logLevel: 'warn',
    },
    async () => ({ status: 'ok' as const }),
  );

  app.get(
    '/ready',
    {
      schema: {
        tags: ['system'],
        summary: 'Readiness: every dependency answers',
        description:
          'Returns 200 when Postgres, Chroma, Langflow and Keycloak all answer, 503 otherwise. ' +
          'No detail is given here; admins get it, and the state of the model providers, from `GET /v1/system`.',
        response: { 200: Ready, 503: Ready },
      },
      logLevel: 'warn',
    },
    async (req, reply) => {
      const results = await runChecks(opts.checks, opts.timeoutMs);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) {
        req.log.warn({ failed }, 'not ready');
        return reply.status(503).send({ status: 'unavailable' as const });
      }
      return { status: 'ok' as const };
    },
  );
};
