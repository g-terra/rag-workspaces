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
import type { Database } from '@rag/db';
import type { LangflowClient } from '@rag/langflow-client';
import { auth } from './auth/plugin.js';
import type { Authenticator } from './auth/principal.js';
import type { Config } from './config.js';
import { errorHandler, notFoundHandler } from './errors.js';
import type { ReadinessCheck } from './readiness.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { documentRoutes } from './routes/documents.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { passageRoutes } from './routes/passages.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { ChromaService } from './services/chroma.js';
import { DocumentEvents } from './services/document-events.js';
import { noopQueue, type IngestQueue } from './services/ingest-queue.js';
import { UploadStorage } from './services/storage.js';

export type AppDeps = {
  config: Config;
  /** The app database. Routes that need it are only registered when it is given (tests can leave it out). */
  db?: Database;
  /** Runs the search and answer flows. Routes that need it are only registered when it is given. */
  langflow?: LangflowClient;
  /** Defaults to a client for CHROMA_URL. */
  chroma?: ChromaService;
  /** Defaults to UPLOADS_DIR. */
  storage?: UploadStorage;
  /** Where new uploads are queued for ingestion. */
  queue?: IngestQueue;
  /** Document status changes, for the live status stream. */
  events?: DocumentEvents;
  /** Dependency checks for `/ready`. */
  checks?: ReadinessCheck[];
  /** Turn bearer credentials into a principal: API keys and Keycloak tokens. */
  authenticators?: Authenticator[];
  /** Logger options, or a ready pino instance shared with services started outside Fastify. */
  logger?: FastifyServerOptions['logger'];
  loggerInstance?: FastifyServerOptions['loggerInstance'];
};

const REQUEST_ID_HEADER = 'x-request-id';

export async function buildApp({
  config,
  db,
  langflow,
  chroma = new ChromaService(config),
  storage = new UploadStorage(config.UPLOADS_DIR, config.MAX_UPLOAD_BYTES),
  queue = noopQueue,
  events = new DocumentEvents(),
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
        { name: 'workspaces', description: 'Isolated groups of material, and who can use them' },
        { name: 'documents', description: 'Files in a workspace and their ingestion status' },
        { name: 'passages', description: 'Search the material without an AI answer' },
        { name: 'api-keys', description: 'API keys for agents and scripts (admins only)' },
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
  if (db) {
    await app.register(workspaceRoutes, { db, chroma, storage, config });
    await app.register(documentRoutes, { db, storage, chroma, queue, events, config });
    await app.register(apiKeyRoutes, { db });
    if (langflow) await app.register(passageRoutes, { db, chroma, langflow, config });
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
