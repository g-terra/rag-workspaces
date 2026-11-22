import pino from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { chromaCheck, keycloakCheck } from './services/checks.js';
import { LangflowService } from './services/langflow.js';

const config = loadConfig();
const logger =
  config.NODE_ENV === 'development'
    ? pino({ level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } })
    : pino({ level: config.LOG_LEVEL });

const langflow = new LangflowService({ config, log: logger.child({ component: 'langflow' }) });

const app = await buildApp({
  config,
  loggerInstance: logger,
  checks: [chromaCheck(config), keycloakCheck(config), langflow.readinessCheck()],
});

// Stop accepting requests and let in-flight ones finish on `docker compose stop`.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    langflow.stop();
    app.close().then(
      () => process.exit(0),
      (err) => {
        app.log.error({ err }, 'shutdown failed');
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
// Get a Langflow key after listening, so /health answers while Langflow is still slow.
await langflow.start();
