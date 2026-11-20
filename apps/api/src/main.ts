import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({
  config,
  logger:
    config.NODE_ENV === 'development'
      ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } }
      : { level: config.LOG_LEVEL },
});

// Stop accepting requests and let in-flight ones finish on `docker compose stop`.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
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
