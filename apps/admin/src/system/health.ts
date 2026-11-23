import type { DefaultModel, ModelProviderId, ProviderStatus, ServiceStatus, SystemStatus } from '@rag/shared';

/** `off` is a provider nobody set up: shown, but not a problem. */
export type HealthState = 'ok' | 'down' | 'off';

export type HealthRow = {
  group: 'service' | 'provider' | 'model';
  name: string;
  state: HealthState;
  detail: string;
};

const SERVICE_NAMES: Record<string, string> = {
  postgres: 'Postgres',
  chroma: 'ChromaDB',
  langflow: 'Langflow',
  keycloak: 'Keycloak',
};

const PROVIDER_NAMES: Record<ModelProviderId, string> = {
  lmstudio: 'LM Studio',
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
};

/** `GET /v1/system` as rows for the System page, and how many of them need attention. */
export function summarizeSystem(system: SystemStatus): { problems: number; rows: HealthRow[] } {
  const rows: HealthRow[] = [
    ...system.services.map(serviceRow),
    ...system.providers.map(providerRow),
    modelRow('Chat model', system.defaults.chat),
    modelRow('Embedding model', system.defaults.embedding),
  ];
  return { problems: rows.filter((r) => r.state === 'down').length, rows };
}

function serviceRow(s: ServiceStatus): HealthRow {
  return {
    group: 'service',
    name: SERVICE_NAMES[s.name] ?? s.name,
    state: s.ok ? 'ok' : 'down',
    detail: s.ok ? `${s.latencyMs} ms` : (s.error ?? 'Not answering'),
  };
}

function providerRow(p: ProviderStatus): HealthRow {
  const name = PROVIDER_NAMES[p.id];
  if (!p.configured) return { group: 'provider', name, state: 'off', detail: 'Not set up' };
  if (!p.reachable) return { group: 'provider', name, state: 'down', detail: p.error ?? 'Not reachable' };
  const n = p.models.length;
  return { group: 'provider', name, state: 'ok', detail: `${n} ${n === 1 ? 'model' : 'models'}` };
}

function modelRow(name: string, m: DefaultModel): HealthRow {
  const what = `${m.model} on ${PROVIDER_NAMES[m.provider]}`;
  return m.available
    ? { group: 'model', name, state: 'ok', detail: what }
    : { group: 'model', name, state: 'down', detail: `${what} is not available` };
}
