import { z } from 'zod';
import { WorkspaceSlug } from './common.js';
import { StyleSlug } from './styles.js';

/** A passage the model was given, in rank order. `rank` is the `[n]` it may cite in the text. */
export const Citation = z.object({
  rank: z.number().int(),
  passageId: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  /** For a page of an imported website, its URL, so the citation can link to it; otherwise `null`. */
  sourceUrl: z.string().nullable(),
  page: z.number().int().nullable(),
  /** For a video or audio transcript, the second the passage starts at; otherwise `null`. */
  startSeconds: z.number().nullable(),
  /** The start of the passage, for a preview; fetch the passage for all of it. */
  snippet: z.string(),
  score: z.number(),
});
export type Citation = z.infer<typeof Citation>;

/** Token counts are `null` when the provider does not report them. */
export const Usage = z.object({
  promptTokens: z.number().int().nullable(),
  completionTokens: z.number().int().nullable(),
});

export const Feedback = z.object({
  rating: z.enum(['up', 'down']),
  comment: z.string().trim().max(2000).nullable().optional(),
});
export type Feedback = z.infer<typeof Feedback>;

export const Answer = z.object({
  id: z.string(),
  workspace: WorkspaceSlug,
  question: z.string(),
  /** `null` when generation failed (`status: "failed"`). */
  text: z.string().nullable(),
  status: z.enum(['complete', 'failed']),
  /**
   * `false` when the answer does not rest on the material: nothing was relevant enough (the model was
   * not asked, citations are empty), or the reply cites none of the passages it was given.
   */
  grounded: z.boolean(),
  citations: z.array(Citation),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** The response style the answer was written in, or `null` for none. */
  style: StyleSlug.nullable(),
  usage: Usage,
  latencyMs: z.number().int(),
  timeToFirstTokenMs: z.number().int().nullable(),
  error: z.string().nullable(),
  feedback: Feedback.extend({ comment: z.string().nullable(), createdAt: z.iso.datetime() }).nullable(),
  createdAt: z.iso.datetime(),
});
export type Answer = z.infer<typeof Answer>;

export const AskQuestion = z.object({
  question: z.string().trim().min(1).max(4000),
  /** How many passages the model gets. Defaults to the workspace's `topK`, then `DEFAULT_TOP_K`. */
  maxPassages: z.number().int().min(1).max(20).optional(),
  /** Only use passages from documents in this folder. */
  folderId: z.string().min(1).optional(),
  /** A response style slug (`GET /v1/styles`). Left out: the workspace's `settings.style`; `null`: no style. */
  style: StyleSlug.nullable().optional(),
});
export type AskQuestion = z.infer<typeof AskQuestion>;
