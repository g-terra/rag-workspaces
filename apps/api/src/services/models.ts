import type { ModelProviderId, ProviderStatus } from '@rag/shared';
import type { Config } from '../config.js';

type CatalogConfig = Pick<
  Config,
  'LMSTUDIO_BASE_URL' | 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'ANTHROPIC_API_KEY'
>;

type Source = {
  label: string;
  /** Undefined when the provider is not configured (its key is not set). */
  request?: { url: string; headers: Record<string, string> };
  /** Fix the provider's ids up to the ones the flows take (Gemini says `models/gemini-...`). */
  id?: (raw: string) => string;
};

export const PROVIDERS: readonly ModelProviderId[] = ['lmstudio', 'openai', 'gemini', 'anthropic'];

/**
 * Asks each model provider which models it offers, with the keys in the config it is given (the
 * API's environment, or a workspace's own keys over it).
 * Every one of them answers `GET .../models` with `{ data: [{ id }] }`. The keys only go to
 * their own provider, and never into the response.
 */
export class ModelCatalog {
  constructor(
    private readonly config: CatalogConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async status(signal: AbortSignal): Promise<ProviderStatus[]> {
    return Promise.all(PROVIDERS.map((id) => this.provider(id, signal)));
  }

  /** One provider, asked with the key in this catalogue's config. */
  async provider(id: ModelProviderId, signal: AbortSignal): Promise<ProviderStatus> {
    return (await this.check(id, signal)).status;
  }

  /**
   * The same, plus whether the provider answered and turned the key down (HTTP 400, 401 or 403:
   * Gemini says 400 for a bad key) rather than being down, slow or busy.
   */
  async check(
    id: ModelProviderId,
    signal: AbortSignal,
  ): Promise<{ status: ProviderStatus; refused: boolean }> {
    const status = await this.ask(id, signal);
    return { status, refused: status.error?.includes('refused the key') ?? false };
  }

  private async ask(id: ModelProviderId, signal: AbortSignal): Promise<ProviderStatus> {
    const source = this.source(id);
    const base = { id, embeddings: id !== 'anthropic' };
    if (!source.request) {
      return { ...base, configured: false, reachable: null, error: `${keyName(id)} is not set`, models: [] };
    }
    try {
      const res = await this.fetchFn(source.request.url, { headers: source.request.headers, signal });
      if (!res.ok) {
        const why =
          [400, 401, 403].includes(res.status) && id !== 'lmstudio' ? 'refused the key' : 'answered';
        throw new Error(`${source.label} ${why} (HTTP ${res.status})`);
      }
      const body = (await res.json()) as { data?: { id?: unknown }[] };
      const models = (body.data ?? [])
        .map((m) => (typeof m.id === 'string' ? (source.id?.(m.id) ?? m.id) : undefined))
        .filter((m): m is string => !!m)
        .sort();
      return { ...base, configured: true, reachable: true, error: null, models };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const error =
        id === 'lmstudio' && !reason.startsWith(source.label)
          ? `could not reach LM Studio at ${this.config.LMSTUDIO_BASE_URL} (${reason}). Is it running, with its server started?`
          : reason;
      return { ...base, configured: true, reachable: false, error, models: [] };
    }
  }

  private source(id: ModelProviderId): Source {
    const c = this.config;
    switch (id) {
      case 'lmstudio':
        return {
          label: 'LM Studio',
          request: { url: `${c.LMSTUDIO_BASE_URL.replace(/\/+$/, '')}/models`, headers: {} },
        };
      case 'openai':
        return {
          label: 'OpenAI',
          request: c.OPENAI_API_KEY
            ? {
                url: 'https://api.openai.com/v1/models',
                headers: { authorization: `Bearer ${c.OPENAI_API_KEY}` },
              }
            : undefined,
        };
      case 'gemini':
        return {
          label: 'Gemini',
          request: c.GEMINI_API_KEY
            ? {
                url: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
                headers: { authorization: `Bearer ${c.GEMINI_API_KEY}` },
              }
            : undefined,
          id: (raw) => raw.replace(/^models\//, ''),
        };
      case 'anthropic':
        return {
          label: 'Anthropic',
          request: c.ANTHROPIC_API_KEY
            ? {
                url: 'https://api.anthropic.com/v1/models?limit=1000',
                headers: { 'x-api-key': c.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
              }
            : undefined,
        };
    }
  }
}

function keyName(id: ModelProviderId) {
  return `${id.toUpperCase()}_API_KEY`;
}
