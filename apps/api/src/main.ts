import { createDb, runMigrations } from '@rag/db';
import pino from 'pino';
import { buildApp } from './app.js';
import { apiKeyAuthenticator } from './auth/api-keys.js';
import { keycloakAuthenticator, keycloakOptionsFromConfig } from './auth/keycloak.js';
import { loadConfig } from './config.js';
import { chromaCheck, keycloakCheck } from './services/checks.js';
import { ChromaService } from './services/chroma.js';
import { DocumentEvents } from './services/document-events.js';
import { IngestProcessor, PgBossIngestQueue } from './services/ingest.js';
import { LangflowService } from './services/langflow.js';
import { UsageLog } from './usage/log.js';

const config = loadConfig();
const logger =
  config.NODE_ENV === 'development'
    ? pino({ level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } })
    : pino({ level: config.LOG_LEVEL });

// Bring the schema up to date before serving anything. A failed migration stops the API.
logger.info('running database migrations');
await runMigrations(config.DATABASE_URL);
const database = createDb(config.DATABASE_URL);

const langflow = new LangflowService({ config, log: logger.child({ component: 'langflow' }) });

const chroma = new ChromaService(config);
const events = new DocumentEvents();
const queue = new PgBossIngestQueue(
  config.DATABASE_URL,
  new IngestProcessor({
    db: database.db,
    langflow: langflow.client,
    chroma,
    events,
    config,
    log: logger.child({ component: 'ingest' }),
  }),
  logger.child({ component: 'queue' }),
  { maxAttempts: config.INGEST_MAX_ATTEMPTS },
);

const usage = new UsageLog(database.db, logger.child({ component: 'usage' }));

const app = await buildApp({
  config,
  usage,
  loggerInstance: logger,
  db: database.db,
  langflow: langflow.client,
  chroma,
  queue,
  events,
  authenticators: [
    apiKeyAuthenticator(database.db),
    keycloakAuthenticator(keycloakOptionsFromConfig(config)),
  ],
  checks: [
    { name: 'postgres', check: () => database.ping() },
    chromaCheck(config),
    keycloakCheck(config),
    langflow.readinessCheck(),
  ],
});

// Clear old question text from the usage log now and every six hours.
const trimUsage = () =>
  usage
    .trimQuestions(config.USAGE_QUESTION_RETENTION_DAYS)
    .then((n) => n && app.log.info({ rows: n }, 'cleared old question text from the usage log'))
    .catch((err: unknown) => app.log.warn({ err }, 'usage retention failed'));
void trimUsage();
setInterval(trimUsage, 6 * 60 * 60 * 1000).unref();

// Stop accepting requests and let in-flight ones finish on `docker compose stop`.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    langflow.stop();
    queue
      .stop()
      .then(() => app.close())
      .then(() => usage.flush())
      .then(() => database.close())
      .then(
        () => process.exit(0),
        (err) => {
          app.log.error({ err }, 'shutdown failed');
          process.exit(1);
        },
      );
  });
}

await queue.start();
await app.listen({ host: config.HOST, port: config.PORT });
// Get a Langflow key after listening, so /health answers while Langflow is still slow.
await langflow.start();
// Take ingestion jobs only once Langflow is usable, so waiting for it doesn't use up retries.
void langflow.ready
  .then(() => queue.startWorking())
  .catch((err: unknown) => app.log.error({ err }, 'ingestion could not start; documents stay queued'));
