import { randomUUID } from 'node:crypto';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { auth } from './auth/plugin.js';
import type { Authenticator } from './auth/principal.js';
import type { Config } from './config.js';
import { errorHandler, notFoundHandler } from './errors.js';
import type { ReadinessCheck } from './readiness.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';

export type AppDeps = {
  config: Config;
  /** Dependency checks for `/ready`. */
  checks?: ReadinessCheck[];
  /** Turn bearer credentials into a principal: Keycloak tokens now, API keys next. */
  authenticators?: Authenticator[];
  /** Logger options, or a ready pino instance shared with services started outside Fastify. */
  logger?: FastifyServerOptions['logger'];
  loggerInstance?: FastifyServerOptions['loggerInstance'];
};

const REQUEST_ID_HEADER = 'x-request-id';

export async function buildApp({
  config,
  checks = [],
  authenticators = [],
  logger,
  loggerInstance,
}: AppDeps) {
  const app = Fastify({
    ...(loggerInstance ? { loggerInstance } : { logger: logger ?? { level: config.LOG_LEVEL } }),
    // Keep a caller's request id (useful when a proxy sets one), otherwise make one.
    requestIdHeader: REQUEST_ID_HEADER,
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.addHook('onSend', async (req, reply) => {
    reply.header(REQUEST_ID_HEADER, req.id);
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'rag-workspaces API',
        version: '0.1.0',
        description:
          'Ask questions over your own material, organised in isolated workspaces. ' +
          'Authenticate with `Authorization: Bearer <Keycloak token or rw_ API key>`.',
      },
      servers: [{ url: config.PUBLIC_API_URL }],
      tags: [
        { name: 'system', description: 'Health and readiness' },
        { name: 'me', description: 'The caller' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'A Keycloak access token (people) or an `rw_` API key (agents and scripts).',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(auth, { authenticators });
  await app.register(healthRoutes, { checks, timeoutMs: config.READY_TIMEOUT_MS });
  await app.register(meRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
