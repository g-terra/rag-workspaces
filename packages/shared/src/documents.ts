import { z } from 'zod';
import { WorkspaceSlug } from './common.js';

export const DocumentType = z.enum(['pdf', 'docx', 'txt', 'md']);
export const DocumentStatus = z.enum(['queued', 'transcribing', 'processing', 'ready', 'failed']);

export const Document = z.object({
  id: z.string(),
  workspace: WorkspaceSlug,
  title: z.string(),
  fileName: z.string(),
  type: DocumentType,
  sizeBytes: z.number().int(),
  sha256: z.string(),
  status: DocumentStatus,
  attempts: z.number().int(),
  /** Why the last attempt failed, in words a person can act on. */
  error: z.string().nullable(),
  passageCount: z.number().int().nullable(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Document = z.infer<typeof Document>;

/** One entry per uploaded file. An identical file already in the workspace comes back with `duplicate: true`. */
export const UploadResult = z.object({
  data: z.array(z.object({ document: Document, duplicate: z.boolean() })),
});
export type UploadResult = z.infer<typeof UploadResult>;

export const DocumentQuery = z.object({
  status: DocumentStatus.optional(),
  type: DocumentType.optional(),
});
