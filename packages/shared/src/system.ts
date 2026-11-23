import { z } from 'zod';
import { ReasoningEffort } from './workspaces.js';

/** One dependency of the API, as `/ready` checks it. */
export const ServiceStatus = z.object({
  name: z.string(),
  ok: z.boolean(),
  latencyMs: z.number().int(),
  /** Why it failed, in words, or null when it answered. */
  error: z.string().nullable(),
});
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const ModelProviderId = z.enum(['lmstudio', 'openai', 'gemini', 'anthropic']);
export type ModelProviderId = z.infer<typeof ModelProviderId>;

/** A model provider and the models it offers right now. */
export const ProviderStatus = z.object({
  id: ModelProviderId,
  /** LM Studio always is; a hosted provider is when its key is set in `.env`. */
  configured: z.boolean(),
  /** null when it was not asked (not configured). */
  reachable: z.boolean().nullable(),
  error: z.string().nullable(),
  /** Model ids as the provider names them, sorted. Empty when it was not reachable. */
  models: z.array(z.string()),
  /** Can embed: anthropic has no embeddings API. */
  embeddings: z.boolean(),
});
export type ProviderStatus = z.infer<typeof ProviderStatus>;

/** A default from `.env`, and whether its provider is reachable and offers it now. */
export const DefaultModel = z.object({
  provider: ModelProviderId,
  model: z.string(),
  available: z.boolean(),
});
export type DefaultModel = z.infer<typeof DefaultModel>;

/** The values a workspace uses for any setting it leaves empty (`null`). */
export const WorkspaceDefaults = z.object({
  chunkSize: z.number().int(),
  chunkOverlap: z.number().int(),
  topK: z.number().int(),
  minScore: z.number(),
  systemPrompt: z.string(),
  /** `null`: no reasoning effort is sent unless the workspace sets one. */
  reasoningEffort: ReasoningEffort.nullable(),
});
export type WorkspaceDefaults = z.infer<typeof WorkspaceDefaults>;

/** `GET /v1/system`: the detail behind `/ready`, for admins. */
export const SystemStatus = z.object({
  version: z.string(),
  /** `degraded` when a service is down or a default model is not available. */
  status: z.enum(['ok', 'degraded']),
  services: z.array(ServiceStatus),
  /** Where the API's Langflow key came from: minted at start (`auto`), `LANGFLOW_API_KEY` (`env`), or none yet. */
  langflowKey: z.enum(['auto', 'env', 'none']),
  providers: z.array(ProviderStatus),
  defaults: z.object({
    chat: DefaultModel,
    embedding: DefaultModel,
    /** What each empty workspace setting falls back to: the API's `.env` values and built-in prompt. */
    workspace: WorkspaceDefaults,
  }),
});
export type SystemStatus = z.infer<typeof SystemStatus>;
