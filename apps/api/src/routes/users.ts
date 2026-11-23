import { page, User, UserQuery } from '@rag/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAdmin } from '../auth/plugin.js';
import type { KeycloakDirectory } from '../services/people.js';

export const userRoutes: FastifyPluginAsyncZod<{ directory: Pick<KeycloakDirectory, 'list'> }> = async (
  app,
  { directory },
) => {
  app.get(
    '/v1/users',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['users'],
        summary: 'People in Keycloak (admins only)',
        description:
          'Read-only: accounts are created in Keycloak’s admin console. Use an `id` from here as the ' +
          '`userId` of `PUT /v1/workspaces/{slug}/members/{userId}` to grant access before someone first ' +
          'signs in. `503` when Keycloak cannot be reached or the people list is not set up.',
        security: [{ bearerAuth: [] }],
        querystring: UserQuery,
        response: { 200: page(User) },
      },
    },
    async (req) => directory.list(req.query),
  );
};
