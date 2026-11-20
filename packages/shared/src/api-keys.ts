import { z } from 'zod';
import { WorkspaceSlug } from './common.js';

export const WorkspaceRole = z.enum(['reader', 'editor']);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

/** An API key as admins see it. The secret is never returned after creation. */
export const ApiKey = z.object({
  id: z.string(),
  name: z.string(),
  /** First characters of the secret, to tell keys apart. */
  prefix: z.string(),
  role: WorkspaceRole,
  workspaces: z.array(WorkspaceSlug),
  expiresAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ApiKey = z.infer<typeof ApiKey>;

/** `POST /v1/api-keys` → 201: the only time `secret` is shown. */
export const CreatedApiKey = ApiKey.extend({ secret: z.string() });
export type CreatedApiKey = z.infer<typeof CreatedApiKey>;

export const CreateApiKey = z.object({
  name: z.string().trim().min(1).max(100),
  role: WorkspaceRole,
  workspaces: z.array(WorkspaceSlug).min(1).max(100),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type CreateApiKey = z.infer<typeof CreateApiKey>;

export const UpdateApiKey = CreateApiKey.omit({ role: true }).partial();
export type UpdateApiKey = z.infer<typeof UpdateApiKey>;
