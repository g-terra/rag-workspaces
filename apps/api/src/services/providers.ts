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
