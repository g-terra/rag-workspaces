import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpProblem } from '../errors.js';
import { InvalidCredentials, type Authenticator, type Principal } from './principal.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The caller, or `null` when the request carried no credentials. */
    principal: Principal | null;
  }
}

export type AuthPluginOptions = { authenticators: Authenticator[] };

/**
 * Reads `Authorization: Bearer <credential>` on every request and sets `request.principal`.
 * It does not reject anonymous requests itself: routes opt in with `requireUser`, so `/health`, `/ready` and `/docs` stay public.
 */
const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, { authenticators }) => {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    if (!header) return;
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw unauthorized('Use "Authorization: Bearer <token or API key>".');
    const credential = match[1]!;
    try {
      for (const authenticate of authenticators) {
        const principal = await authenticate(credential);
        if (principal) {
          req.principal = principal;
          return;
        }
      }
    } catch (err) {
      if (err instanceof InvalidCredentials) {
        req.log.info({ reason: err.message }, 'rejected credentials');
        throw unauthorized('Invalid or expired token.');
      }
      throw err;
    }
    throw unauthorized('Invalid or expired token.');
  });
};

export const auth = fp(authPlugin, { name: 'auth' });

function unauthorized(detail: string) {
  return new HttpProblem(401, detail);
}

/** preHandler: any signed-in caller. */
export async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
  if (!req.principal) throw unauthorized('Sign in or send an API key.');
}
