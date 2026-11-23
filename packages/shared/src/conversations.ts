import { z } from 'zod';
import { Citation, Usage } from './answers.js';
import { WorkspaceSlug } from './common.js';
import { StyleSlug } from './styles.js';

export const Message = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(['user', 'assistant']),
  /** `null` for an assistant reply that failed. */
  content: z.string().nullable(),
  status: z.enum(['complete', 'failed']),
  /** Assistant replies only: `false` when nothing in the workspace was relevant enough. */
  grounded: z.boolean().nullable(),
  citations: z.array(Citation),
  model: z.string().nullable(),
  /** Assistant replies: the response style used, or `null` for none. Always `null` for the user's messages. */
  style: StyleSlug.nullable(),
  usage: Usage,
  latencyMs: z.number().int().nullable(),
  timeToFirstTokenMs: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof Message>;

export const Conversation = z.object({
  id: z.string(),
  workspace: WorkspaceSlug,
  title: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Time of the last message. */
  updatedAt: z.iso.datetime(),
});
export type Conversation = z.infer<typeof Conversation>;

export const ConversationWithMessages = Conversation.extend({ messages: z.array(Message) });
export type ConversationWithMessages = z.infer<typeof ConversationWithMessages>;

export const CreateConversation = z.object({ title: z.string().trim().min(1).max(200).optional() });

export const SendMessage = z.object({
  content: z.string().trim().min(1).max(4000),
  /** Only use passages from documents in this folder, for this message. */
  folderId: z.string().min(1).optional(),
  /** A response style slug for this reply (`GET /v1/styles`). Left out: the workspace's `settings.style`; `null`: no style. */
  style: StyleSlug.nullable().optional(),
});
export type SendMessage = z.infer<typeof SendMessage>;

export const ConversationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().regex(/^\d+$/, 'a cursor from a previous page').optional(),
});
