import { z } from 'zod';
import { WorkspaceRole } from './api-keys.js';
import { WorkspaceSlug } from './common.js';

export const ChatProvider = z.enum(['lmstudio', 'openai', 'anthropic', 'gemini']);
/** Anthropic has no embedding models, so it is not an embedding provider. */
export const EmbeddingProvider = z.enum(['lmstudio', 'openai', 'gemini']);

/**
 * Per-workspace settings. `null` means "use the global default from .env", except the
 * embedding provider and model, which are pinned when the workspace is created.
 */
export const WorkspaceSettings = z.object({
  chatProvider: ChatProvider.nullable(),
  chatModel: z.string().min(1).max(200).nullable(),
  embeddingProvider: EmbeddingProvider,
  embeddingModel: z.string().min(1).max(200),
  systemPrompt: z.string().max(10_000).nullable(),
  chunkSize: z.number().int().min(100).max(8000).nullable(),
  chunkOverlap: z.number().int().min(0).max(2000).nullable(),
  topK: z.number().int().min(1).max(50).nullable(),
  minScore: z.number().min(0).max(1).nullable(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

export const Workspace = z.object({
  id: z.string(),
  slug: WorkspaceSlug,
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['active', 'reindexing']),
  settings: WorkspaceSettings,
  /** What the caller may do here: `admin` (global admins), `editor` or `reader`. */
  access: z.enum(['admin', 'editor', 'reader']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Workspace = z.infer<typeof Workspace>;

export const CreateWorkspace = z.object({
  slug: WorkspaceSlug,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  settings: WorkspaceSettings.partial().optional(),
});
export type CreateWorkspace = z.infer<typeof CreateWorkspace>;

export const UpdateWorkspace = CreateWorkspace.omit({ slug: true }).partial();
export type UpdateWorkspace = z.infer<typeof UpdateWorkspace>;

export const WorkspaceMember = z.object({
  userId: z.string(),
  role: WorkspaceRole,
  grantedBy: z.string(),
  createdAt: z.iso.datetime(),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMember>;

export const GrantMember = z.object({ role: WorkspaceRole });
