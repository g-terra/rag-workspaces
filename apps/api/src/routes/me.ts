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
          'The caller: a signed-in person, or an API key with its role and workspaces. ' +
          'Later this also lists the workspaces a person can see and their role in each.',
        security: [{ bearerAuth: [] }],
        response: { 200: Me },
      },
    },
    async (req) => {
      const p = req.principal!;
      if (p.kind === 'key') {
        return {
          kind: p.kind,
          id: p.id,
          name: p.name,
          role: p.role,
          workspaces: p.workspaces.map((w) => w.slug),
        };
      }
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
