import { z } from 'zod';
import { ProviderStatus } from './system.js';

/** The providers that need an API key; LM Studio runs on this machine and needs none. */
export const HostedProvider = z.enum(['openai', 'gemini', 'anthropic']);
export type HostedProvider = z.infer<typeof HostedProvider>;

/**
 * A model provider as one workspace sees it: asked with the workspace's own key when it has one,
 * else with the key in `.env`. The key itself is never returned.
 */
export const WorkspaceProvider = ProviderStatus.extend({
  key: z.object({
    /** `workspace`: saved for this workspace in the admin UI. `env`: from `.env`. null: none (or LM Studio). */
    source: z.enum(['workspace', 'env']).nullable(),
    /** The last four characters of a key saved for this workspace, so admins can tell keys apart. */
    last4: z.string().nullable(),
  }),
});
export type WorkspaceProvider = z.infer<typeof WorkspaceProvider>;

/** `PUT /v1/workspaces/{slug}/providers/{provider}/key`. */
export const SetProviderKey = z.strictObject({ apiKey: z.string().trim().min(20).max(500) });
export type SetProviderKey = z.infer<typeof SetProviderKey>;
