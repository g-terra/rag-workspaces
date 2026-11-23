import type { Config } from '../config.js';

export type EmbeddingEndpoint = { baseUrl: string; apiKey: string };

/** Text put before each document and each query before they are embedded. */
export type EmbeddingPrefixes = { document: string; query: string };

/**
 * Task prefixes some embedding models were trained with; without them their search is weaker. Matched
 * against the model id, which differs between servers (LM Studio adds `text-embedding-`).
 * - nomic-embed-text: `search_document: ` and `search_query: ` (its model card).
 * - Qwen3-Embedding: an instruction on queries only, in its `Instruct: …\nQuery:` format.
 */
const KNOWN_PREFIXES: [RegExp, EmbeddingPrefixes][] = [
  [/nomic-embed-text/i, { document: 'search_document: ', query: 'search_query: ' }],
  [
    /qwen3-embedding/i,
    { document: '', query: 'Instruct: Given a question, retrieve passages that answer the question\nQuery:' },
  ],
];

/** The prefixes for an embedding model: `EMBEDDING_PREFIXES` first, then the built-in ones, else none. */
export function embeddingPrefixes(
  model: string,
  config: Pick<Config, 'EMBEDDING_PREFIXES'>,
): EmbeddingPrefixes {
  const configured = config.EMBEDDING_PREFIXES[model];
  if (configured) return configured;
  return KNOWN_PREFIXES.find(([pattern]) => pattern.test(model))?.[1] ?? { document: '', query: '' };
}

/** Thrown when a workspace names a provider it has no usable key for (in `.env` or saved for it). */
export class ProviderNotConfigured extends Error {}

/**
 * Put in place of a key saved for a workspace that won't open (`SECRETS_KEY` missing or changed), by
 * `withWorkspaceKeys`. Never sent anywhere: the endpoints below refuse it with the reason.
 */
export const UNREADABLE_KEY = '\u0000unreadable';

function usable(name: string, value: string | undefined): string {
  if (value === UNREADABLE_KEY) {
    throw new ProviderNotConfigured(
      `the ${name} saved for this workspace can't be read (SECRETS_KEY is missing or changed); save it again in the workspace settings`,
    );
  }
  if (!value) throw new ProviderNotConfigured(`${name} is not set`);
  return value;
}

/**
 * Where a workspace's embeddings come from. The ingest flow's embeddings node speaks the
 * OpenAI embeddings API, which LM Studio, OpenAI and Gemini all offer. Keys come from the
 * API's environment, or the workspace's own saved keys (`withWorkspaceKeys`), and travel to Langflow
 * as tweaks on each run (POC finding F7).
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
      return {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: usable('OPENAI_API_KEY', config.OPENAI_API_KEY),
      };
    case 'gemini':
      return {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey: usable('GEMINI_API_KEY', config.GEMINI_API_KEY),
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
  const key = (name: 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'ANTHROPIC_API_KEY') => usable(name, config[name]);
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
