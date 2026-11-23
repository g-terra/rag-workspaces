import type { DefaultModel, ModelProviderId, ProviderStatus, ServiceStatus, SystemStatus } from '@rag/shared';

/** One thing that is wrong, and the next thing to do about it. */
export interface Problem {
  what: string;
  fix: string;
}

const SERVICE_LABELS: Record<string, string> = {
  postgres: 'Postgres',
  chroma: 'ChromaDB',
  langflow: 'Langflow',
  keycloak: 'Keycloak',
};

const PROVIDER_LABELS: Record<ModelProviderId, string> = {
  lmstudio: 'LM Studio',
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
};

/** The name people use for a service, or the API's own name for one this app has not met. */
export function serviceLabel(name: string): string {
  return SERVICE_LABELS[name] ?? name;
}

export function providerLabel(id: ModelProviderId): string {
  return PROVIDER_LABELS[id] ?? id;
}

/** What to do when a service is down. A new service the API adds gets the generic answer. */
const SERVICE_FIXES: Record<string, string> = {
  postgres: 'Check the `postgres` container: `docker compose logs postgres`.',
  chroma: 'Check the `chroma` container: `docker compose logs chroma`. Search and answers need it.',
  langflow:
    'Check the `langflow` container: `docker compose logs langflow`. Ingestion, answers and chat all go through it.',
  keycloak:
    'Check the `keycloak` container: `docker compose logs keycloak`. Nobody can sign in while it is down.',
};

const KEY_ENV: Record<ModelProviderId, string | null> = {
  lmstudio: null,
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

/** What to do when a provider is not serving its models. LM Studio runs on the host, not in compose. */
function providerFix(id: ModelProviderId, configured: boolean): string {
  if (id === 'lmstudio') {
    return 'Start LM Studio and its local server, and load the model. The API reaches it at LMSTUDIO_BASE_URL.';
  }
  const env = KEY_ENV[id];
  return configured
    ? `Check this machine's network access to ${providerLabel(id)}, and that the model is still offered.`
    : `Set ${env} in .env and restart the API, or choose another provider.`;
}

/**
 * The one thing to put in front of an admin, or `null` when there is nothing to say. Only asked
 * when the API itself calls the system `degraded`: it decides what counts, and a banner that
 * second-guessed it would fire on things the API is content with.
 *
 * Services come first — everything else depends on them — then the default chat and embedding
 * models, which are the usual cause (LM Studio not running).
 */
export function firstProblem(system: SystemStatus): Problem | null {
  if (system.status !== 'degraded') return null;

  const down = system.services.find((s) => !s.ok);
  if (down) {
    return {
      what: `${serviceLabel(down.name)} isn't answering: ${down.error ?? 'no reason given'}`,
      fix: SERVICE_FIXES[down.name] ?? `Check its container's logs: \`docker compose logs ${down.name}\`.`,
    };
  }

  for (const [kind, model] of [
    ['chat', system.defaults.chat],
    ['embedding', system.defaults.embedding],
  ] as const) {
    if (!model.available) return defaultProblem(kind, model, system.providers);
  }

  // The API found something this app cannot read: say so plainly rather than nothing at all.
  return {
    what: 'Something the API depends on is not healthy',
    fix: 'Open the System page for the detail behind it.',
  };
}

function defaultProblem(
  kind: 'chat' | 'embedding',
  model: DefaultModel,
  providers: ProviderStatus[],
): Problem {
  const provider = providers.find((p) => p.id === model.provider);
  const why = provider?.error ?? 'the provider does not offer it';
  return {
    what: `The default ${kind} model (${providerLabel(model.provider)} / ${model.model}) is not available: ${why}`,
    fix: providerFix(model.provider, provider?.configured ?? false),
  };
}

/** The line beside a service: how fast it answered, or why it did not. */
export function latencyNote(service: ServiceStatus): string {
  if (service.ok) return `answered in ${service.latencyMs} ms`;
  return service.error ?? 'did not answer';
}

/** The line beside a provider: what it offers now, or why it offers nothing. */
export function providerDetail(provider: ProviderStatus): string {
  if (provider.error) return provider.error;
  const models = `${provider.models.length} model${provider.models.length === 1 ? '' : 's'}`;
  // Worth saying: it explains why a provider with models is not an embedding choice.
  return provider.embeddings ? models : `${models} · chat only`;
}

/** Where the API's Langflow key came from, which decides what happens on a Langflow restart. */
export function langflowKeyNote(key: SystemStatus['langflowKey']): string {
  if (key === 'auto') return 'minted by the API at start-up';
  if (key === 'env') return 'from LANGFLOW_API_KEY';
  return 'no key yet: the API could not mint one';
}
