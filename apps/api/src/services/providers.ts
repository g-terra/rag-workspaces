import type { Config } from '../config.js';

export type EmbeddingEndpoint = { baseUrl: string; apiKey: string };

/** Thrown when a workspace names a provider whose key is not set in `.env`. */
export class ProviderNotConfigured extends Error {}

/**
 * Where a workspace's embeddings come from. The ingest flow's embeddings node speaks the
 * OpenAI embeddings API, which LM Studio, OpenAI and Gemini all offer. Keys come from the
 * API's environment and travel to Langflow as tweaks on each run (POC finding F7).
 */
export function embeddingEndpoint(
  provider: string,
  config: Pick<Config, 'LMSTUDIO_BASE_URL' | 'OPENAI_API_KEY' | 'GEMINI_API_KEY'>,
): EmbeddingEndpoint {
  switch (provider) {
    case 'lmstudio':
      // LM Studio ignores the key, but the client needs a non-empty one.
      return { baseUrl: config.LMSTUDIO_BASE_URL, apiKey: 'lm-studio' };
    case 'openai':
      if (!config.OPENAI_API_KEY) throw new ProviderNotConfigured('OPENAI_API_KEY is not set');
      return { baseUrl: 'https://api.openai.com/v1', apiKey: config.OPENAI_API_KEY };
    case 'gemini':
      if (!config.GEMINI_API_KEY) throw new ProviderNotConfigured('GEMINI_API_KEY is not set');
      return {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey: config.GEMINI_API_KEY,
      };
    default:
      throw new ProviderNotConfigured(`unknown embedding provider "${provider}"`);
  }
}

export type ChatEndpoint = { provider: string; model: string; baseUrl: string; apiKey: string };

type ChatConfig = Pick<
  Config,
  | 'DEFAULT_CHAT_PROVIDER'
  | 'DEFAULT_CHAT_MODEL'
  | 'LMSTUDIO_BASE_URL'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'ANTHROPIC_API_KEY'
>;

/**
 * Which chat model answers in a workspace: its own setting, else the global default. An empty
 * `baseUrl` lets the flow's chat node use the provider's own endpoint.
 */
export function chatEndpoint(
  settings: { chatProvider?: string | null; chatModel?: string | null },
  config: ChatConfig,
): ChatEndpoint {
  const provider = settings.chatProvider ?? config.DEFAULT_CHAT_PROVIDER;
  const model = settings.chatModel ?? config.DEFAULT_CHAT_MODEL;
  const key = (name: 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'ANTHROPIC_API_KEY') => {
    const value = config[name];
    if (!value) throw new ProviderNotConfigured(`${name} is not set`);
    return value;
  };
  switch (provider) {
    case 'lmstudio':
      return { provider, model, baseUrl: config.LMSTUDIO_BASE_URL, apiKey: 'lm-studio' };
    case 'openai':
      return { provider, model, baseUrl: '', apiKey: key('OPENAI_API_KEY') };
    case 'anthropic':
      return { provider, model, baseUrl: '', apiKey: key('ANTHROPIC_API_KEY') };
    case 'gemini':
      return { provider, model, baseUrl: '', apiKey: key('GEMINI_API_KEY') };
    default:
      throw new ProviderNotConfigured(`unknown chat provider "${provider}"`);
  }
}
