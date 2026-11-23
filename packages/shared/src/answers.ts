import { z } from 'zod';
import { WorkspaceSlug } from './common.js';

/** A passage the model was given, in rank order. `rank` is the `[n]` it may cite in the text. */
export const Citation = z.object({
  rank: z.number().int(),
  passageId: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  page: z.number().int().nullable(),
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
  /** `false` when nothing in the workspace was relevant enough; the model was not asked. */
  grounded: z.boolean(),
  citations: z.array(Citation),
  provider: z.string().nullable(),
  model: z.string().nullable(),
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
});
export type AskQuestion = z.infer<typeof AskQuestion>;
