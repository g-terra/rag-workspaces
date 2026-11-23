import { StyleList } from '@rag/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireUser } from '../auth/plugin.js';
import { BUILT_IN_STYLES } from '../services/styles.js';

export const styleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/v1/styles',
    {
      preHandler: requireUser,
      schema: {
        tags: ['styles'],
        summary: 'List response styles',
        description:
          'The styles an answer or chat reply can be written in: pass a slug as `style` when asking, or set ' +
          "it as a workspace's `settings.style`. A style changes tone, length and format only; it is added " +
          "after the workspace's system prompt, so citations and refusals still apply.",
        security: [{ bearerAuth: [] }],
        response: { 200: StyleList },
      },
    },
    async () => ({ data: [...BUILT_IN_STYLES] }),
  );
};
