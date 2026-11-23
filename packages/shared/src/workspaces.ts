import { z } from 'zod';
import { WorkspaceRole } from './api-keys.js';
import { WorkspaceSlug } from './common.js';
import { StyleSlug } from './styles.js';

export const ChatProvider = z.enum(['lmstudio', 'openai', 'anthropic', 'gemini']);
export type ChatProvider = z.infer<typeof ChatProvider>;
/** Anthropic has no embedding models, so it is not an embedding provider. */
export const EmbeddingProvider = z.enum(['lmstudio', 'openai', 'gemini']);
/**
 * How much a reasoning model thinks before it answers, sent as `reasoning_effort` to LM Studio and
 * OpenAI. "none" turns thinking off (Qwen 3 in LM Studio honours it); other providers ignore it.
 */
export const ReasoningEffort = z.enum(['none', 'minimal', 'low', 'medium', 'high']);
export type ReasoningEffort = z.infer<typeof ReasoningEffort>;
export type EmbeddingProvider = z.infer<typeof EmbeddingProvider>;

/**
 * Per-workspace settings. `null` means "use the global default from .env", except the
 * embedding provider and model, which are pinned when the workspace is created (and are `null` for a
 * composite, whose sources each search with their own).
 */
export const WorkspaceSettings = z.object({
  chatProvider: ChatProvider.nullable(),
  chatModel: z.string().min(1).max(200).nullable(),
  embeddingProvider: EmbeddingProvider.nullable(),
  embeddingModel: z.string().min(1).max(200).nullable(),
  /**
   * Text put before each document and query when embedding, pinned with the model (read-only).
   * `null` for a workspace not reindexed since prefixes were added: it embeds without them.
   */
  embeddingPrefixes: z.object({ document: z.string(), query: z.string() }).nullable(),
  systemPrompt: z.string().max(10_000).nullable(),
  chunkSize: z.number().int().min(100).max(8000).nullable(),
  chunkOverlap: z.number().int().min(0).max(2000).nullable(),
  topK: z.number().int().min(1).max(50).nullable(),
  minScore: z.number().min(0).max(1).nullable(),
  /** `null`: the `.env` default (`DEFAULT_REASONING_EFFORT`), and when that is unset too, nothing is sent. */
  reasoningEffort: ReasoningEffort.nullable(),
  /** The response style used when a request names none (`GET /v1/styles`). `null`: no style. */
  style: StyleSlug.nullable(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

/** `standard` holds documents; `composite` holds none and answers from its `sources`. */
const WorkspaceKind = z.enum(['standard', 'composite']);

/** A composite's sources: two to ten standard workspaces, by slug, in the order they are listed. */
const CompositeSources = z
  .array(WorkspaceSlug)
  .min(2)
  .max(10)
  .refine((s) => new Set(s).size === s.length, { message: 'A workspace can be a source only once.' });

/** Settings that belong to a source's material, never to a composite. */
const SOURCE_ONLY = ['embeddingProvider', 'embeddingModel', 'chunkSize', 'chunkOverlap', 'minScore'] as const;

function sourceOnlySet(settings: object | undefined): string | undefined {
  return SOURCE_ONLY.find((k) => settings && (settings as Record<string, unknown>)[k] != null);
}

export const Workspace = z.object({
  id: z.string(),
  slug: WorkspaceSlug,
  name: z.string(),
  description: z.string().nullable(),
  kind: WorkspaceKind,
  /** A composite's source workspaces, by slug, in order; `null` for a standard workspace. */
  sources: z.array(WorkspaceSlug).nullable(),
  status: z.enum(['active', 'reindexing']),
  settings: WorkspaceSettings,
  /** What the caller may do here: `admin` (global admins), `editor` or `reader`. */
  access: z.enum(['admin', 'editor', 'reader']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Workspace = z.infer<typeof Workspace>;

export const CreateWorkspace = z
  .object({
    slug: WorkspaceSlug,
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).nullable().optional(),
    /** Default `standard`. */
    kind: WorkspaceKind.optional(),
    /** Required for a composite, refused for a standard workspace. */
    sources: CompositeSources.optional(),
    settings: WorkspaceSettings.partial().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.kind === 'composite' && !b.sources)
      ctx.addIssue({ code: 'custom', path: ['sources'], message: 'A composite needs its sources.' });
    if (b.kind !== 'composite' && b.sources)
      ctx.addIssue({ code: 'custom', path: ['sources'], message: 'Only a composite has sources.' });
    const own = b.kind === 'composite' && sourceOnlySet(b.settings);
    if (own)
      ctx.addIssue({
        code: 'custom',
        path: ['settings', own],
        message: `A composite has no ${own}: each source uses its own.`,
      });
  });
export type CreateWorkspace = z.infer<typeof CreateWorkspace>;

/** The embedding provider and model are pinned at creation: changing them needs a re-index, so PATCH refuses them. */
export const UpdateWorkspace = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).nullable().optional(),
    /** A composite's new list of sources, replacing the old one. Refused for a standard workspace. */
    sources: CompositeSources,
    settings: WorkspaceSettings.omit({
      embeddingProvider: true,
      embeddingModel: true,
      embeddingPrefixes: true,
    })
      .partial()
      .strict(),
  })
  .partial();
export type UpdateWorkspace = z.infer<typeof UpdateWorkspace>;

/**
 * `POST /v1/workspaces/{slug}/reindex`. Empty: ingest everything again with the current settings
 * (after changing chunking). With a model: switch the workspace to it, the only way to change it.
 */
export const ReindexWorkspace = z
  .object({
    embeddingProvider: EmbeddingProvider.optional(),
    embeddingModel: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((b) => !b.embeddingProvider || b.embeddingModel, {
    message: 'A new embedding provider needs its embeddingModel too.',
    path: ['embeddingModel'],
  });
export type ReindexWorkspace = z.infer<typeof ReindexWorkspace>;

export const WorkspaceMember = z.object({
  userId: z.string(),
  role: WorkspaceRole,
  grantedBy: z.string(),
  createdAt: z.iso.datetime(),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMember>;

export const GrantMember = z.object({ role: WorkspaceRole });
