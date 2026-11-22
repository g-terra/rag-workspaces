import { Me } from '@rag/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireUser } from '../auth/plugin.js';

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/v1/me',
    {
      preHandler: requireUser,
      schema: {
        tags: ['me'],
        summary: 'Who am I',
        description:
          'The signed-in person. Later this also lists the workspaces they can see and their role in each.',
        security: [{ bearerAuth: [] }],
        response: { 200: Me },
      },
    },
    async (req) => {
      const p = req.principal!;
      return {
        kind: p.kind,
        id: p.id,
        username: p.username,
        email: p.email,
        name: p.name,
        isAdmin: p.isAdmin,
      };
    },
  );
};
