import { z } from 'zod';
import { WorkspaceSlug } from './common.js';

export const DocumentType = z.enum(['pdf', 'docx', 'txt', 'md']);
export const DocumentStatus = z.enum(['queued', 'transcribing', 'processing', 'ready', 'failed']);

export const Document = z.object({
  id: z.string(),
  workspace: WorkspaceSlug,
  /** Null: at the workspace's top level. */
  folderId: z.string().nullable(),
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
  /** A folder id, or `none` for the documents at the top level. */
  folderId: z.string().min(1).optional(),
});

const Tag = z.string().trim().min(1).max(50);

/** `PATCH .../documents/{id}`: move it (`folderId`, null for the top level), rename or retag it. */
export const UpdateDocument = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    folderId: z.string().min(1).nullable().optional(),
    tags: z.array(Tag).max(20).optional(),
  })
  .strict();
export type UpdateDocument = z.infer<typeof UpdateDocument>;

export const Folder = z.object({
  id: z.string(),
  workspace: WorkspaceSlug,
  name: z.string(),
  /** Documents directly in it. */
  documentCount: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Folder = z.infer<typeof Folder>;

/** Create or rename. Names are unique in a workspace, ignoring case. */
export const FolderInput = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export type FolderInput = z.infer<typeof FolderInput>;
