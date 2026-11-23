import { SystemStatus, type DefaultModel, type ProviderStatus } from '@rag/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireAdmin } from '../auth/plugin.js';
import type { Config } from '../config.js';
import { runChecks, type ReadinessCheck } from '../readiness.js';
import type { KeySource } from '../services/langflow.js';
import type { ModelCatalog } from '../services/models.js';
import { VERSION } from '../version.js';

export type SystemRoutesOptions = {
  checks: ReadinessCheck[];
  models: Pick<ModelCatalog, 'status'>;
  langflowKey: () => KeySource;
  config: Pick<
    Config,
    | 'READY_TIMEOUT_MS'
    | 'DEFAULT_CHAT_PROVIDER'
    | 'DEFAULT_CHAT_MODEL'
    | 'DEFAULT_EMBEDDING_PROVIDER'
    | 'DEFAULT_EMBEDDING_MODEL'
  >;
};

export const systemRoutes: FastifyPluginAsyncZod<SystemRoutesOptions> = async (
  app,
  { checks, models, langflowKey, config },
) => {
  app.get(
    '/v1/system',
    {
      preHandler: requireAdmin,
      schema: {
        tags: ['system'],
        summary: 'What is up, what is down, and which models are available (admins only)',
        description:
          'The detail behind `/ready`: each service with its latency or the reason it failed, every model ' +
          'provider with the models it offers now (asked with the keys in `.env`; keys are never returned), ' +
          'and whether the default chat and embedding models are among them. `status` is `degraded` when a ' +
          'service is down or a default model is not available. Always `200`, so the admin UI can show why.',
        security: [{ bearerAuth: [] }],
        response: { 200: SystemStatus },
      },
    },
    async () => {
      const [results, providers] = await Promise.all([
        runChecks(checks, config.READY_TIMEOUT_MS),
        models.status(AbortSignal.timeout(config.READY_TIMEOUT_MS)),
      ]);
      const services = results.map((r) => ({ ...r, error: r.error ?? null }));
      const defaults = {
        chat: available(providers, config.DEFAULT_CHAT_PROVIDER, config.DEFAULT_CHAT_MODEL),
        embedding: available(providers, config.DEFAULT_EMBEDDING_PROVIDER, config.DEFAULT_EMBEDDING_MODEL),
      };
      const healthy = services.every((s) => s.ok) && defaults.chat.available && defaults.embedding.available;
      return {
        version: VERSION,
        status: healthy ? ('ok' as const) : ('degraded' as const),
        services,
        langflowKey: langflowKey(),
        providers,
        defaults,
      };
    },
  );
};

/** True only when the provider is configured, answers, and lists the model. */
function available(
  providers: ProviderStatus[],
  provider: DefaultModel['provider'],
  model: string,
): DefaultModel {
  const p = providers.find((x) => x.id === provider);
  if (!p?.configured || !p.reachable) return { provider, model, available: false };
  // LM Studio lists downloaded models; it loads one on first use, so listed means usable.
  return { provider, model, available: p.models.includes(model) };
}
