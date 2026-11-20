import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// The schema grows one table at a time with the features that use it (M1: folders,
// documents; M2: answers, conversations, api keys, usage). Columns are camelCase in
// TypeScript and snake_case in Postgres (drizzle.config.ts `casing`).

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
};

export const workspaceStatus = pgEnum('workspace_status', ['active', 'reindexing']);

/** Optional per-workspace overrides; `null` or missing means the global default from `.env`. */
export type WorkspaceSettings = {
  chatProvider?: string | null;
  chatModel?: string | null;
  embeddingProvider?: string;
  embeddingModel?: string;
  systemPrompt?: string | null;
  chunkSize?: number | null;
  chunkOverlap?: number | null;
  topK?: number | null;
  minScore?: number | null;
};

export const workspaces = pgTable(
  'workspaces',
  {
    id: text().primaryKey(),
    /** Never changes: it names the Chroma collection (`ws_<slug>`) and the upload folder. */
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    status: workspaceStatus().notNull().default('active'),
    settings: jsonb().$type<WorkspaceSettings>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex('workspaces_slug_key').on(t.slug)],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

/** Inside a workspace, people and API keys are `reader` (ask, chat, search) or `editor` (also manage material). */
export const workspaceRole = pgEnum('workspace_role', ['reader', 'editor']);

/**
 * API keys for agents and scripts. Created by admins only. The secret (`rw_` + 32 random
 * bytes) is shown once; only its SHA-256 hash is stored, plus a short prefix for display.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    /** The first characters of the secret (`rw_7Hk2`), so people can tell keys apart. */
    prefix: text().notNull(),
    /** Hex SHA-256 of the full secret. */
    secretHash: text().notNull(),
    role: workspaceRole().notNull(),
    /** Keycloak user id of the admin who created it. */
    createdBy: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex('api_keys_secret_hash_key').on(t.secretHash)],
);

/** Which workspaces a key may use. Deleting a workspace or a key removes its rows. */
export const apiKeyWorkspaces = pgTable(
  'api_key_workspaces',
  {
    apiKeyId: text()
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.apiKeyId, t.workspaceId] }),
    index('api_key_workspaces_workspace_idx').on(t.workspaceId),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;

/** People with access to a workspace, keyed by their Keycloak user id. Admins need no row. */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Keycloak user id (the token's `sub`). Accounts live in Keycloak, not here. */
    userId: text().notNull(),
    role: workspaceRole().notNull(),
    /** Keycloak user id of the admin who granted it. */
    grantedBy: text().notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;

export const documentType = pgEnum('document_type', ['pdf', 'docx', 'txt', 'md']);

/** Ingestion status. `transcribing` is used by video and audio (M5). */
export const documentStatus = pgEnum('document_status', [
  'queued',
  'transcribing',
  'processing',
  'ready',
  'failed',
]);

/**
 * One uploaded file. Postgres is the source of truth: a document is searchable only when
 * its row is `ready`. The file lives on the uploads volume at `storagePath`.
 */
export const documents = pgTable(
  'documents',
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    /** The name the file was uploaded with. */
    fileName: text().notNull(),
    type: documentType().notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    /** Hex SHA-256 of the content; the same file twice in one workspace is a duplicate. */
    sha256: text().notNull(),
    /** Relative to the uploads volume: `<slug>/<document id>.<ext>`. */
    storagePath: text().notNull(),
    status: documentStatus().notNull().default('queued'),
    attempts: integer().notNull().default(0),
    error: text(),
    passageCount: integer(),
    tags: text().array().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('documents_workspace_sha256_key').on(t.workspaceId, t.sha256),
    index('documents_workspace_status_idx').on(t.workspaceId, t.status),
  ],
);

export type Document = typeof documents.$inferSelect;

export const answerStatus = pgEnum('answer_status', ['complete', 'failed']);
export const callerKind = pgEnum('caller_kind', ['user', 'key']);
export const feedbackRating = pgEnum('feedback_rating', ['up', 'down']);

/** A passage given to the model, as stored with the answer (a snapshot: later re-indexing does not change it). */
export type StoredCitation = {
  /** The `[n]` the model saw for this passage. */
  rank: number;
  passageId: string;
  documentId: string;
  documentTitle: string;
  folderId: string | null;
  page: number | null;
  startSeconds: number | null;
  snippet: string;
  score: number;
};

/**
 * One question answered from a workspace's material. Stored whether it worked or not, so
 * failures show in usage. Only the caller who asked (and admins) can read it back.
 */
export const answers = pgTable(
  'answers',
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    askedByKind: callerKind().notNull(),
    /** Keycloak user id or API key id. Not a foreign key: answers outlive revoked keys. */
    askedBy: text().notNull(),
    question: text().notNull(),
    /** `null` when generation failed. */
    text: text(),
    status: answerStatus().notNull(),
    /** False when no passage reached the minimum score; the model was not called. */
    grounded: boolean().notNull(),
    citations: jsonb().$type<StoredCitation[]>().notNull().default([]),
    /** `null` for an ungrounded answer (no model was called). */
    provider: text(),
    model: text(),
    promptTokens: integer(),
    completionTokens: integer(),
    latencyMs: integer().notNull(),
    /** Streaming only. */
    timeToFirstTokenMs: integer(),
    error: text(),
    requestId: text(),
    feedbackRating: feedbackRating(),
    feedbackComment: text(),
    feedbackAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('answers_workspace_created_idx').on(t.workspaceId, t.createdAt)],
);

export type Answer = typeof answers.$inferSelect;
export type NewAnswer = typeof answers.$inferInsert;

/** A chat in a workspace. Private to whoever started it (admins can read any). */
export const conversations = pgTable(
  'conversations',
  {
    id: text().primaryKey(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: callerKind().notNull(),
    /** Keycloak user id or API key id. */
    ownerId: text().notNull(),
    /** Set from the first message unless given. */
    title: text(),
    ...timestamps,
  },
  (t) => [index('conversations_owner_idx').on(t.workspaceId, t.ownerKind, t.ownerId, t.updatedAt)],
);

export type Conversation = typeof conversations.$inferSelect;

export const messageRole = pgEnum('message_role', ['user', 'assistant']);

/**
 * One turn. The history the flow sees comes from here (the flow itself is stateless).
 * Assistant messages carry the same fields as an answer.
 */
export const messages = pgTable(
  'messages',
  {
    id: text().primaryKey(),
    conversationId: text()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: messageRole().notNull(),
    /** `null` for an assistant reply that failed. */
    content: text(),
    status: answerStatus().notNull().default('complete'),
    grounded: boolean(),
    citations: jsonb().$type<StoredCitation[]>().notNull().default([]),
    provider: text(),
    model: text(),
    promptTokens: integer(),
    completionTokens: integer(),
    latencyMs: integer(),
    timeToFirstTokenMs: integer(),
    error: text(),
    requestId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_created_idx').on(t.conversationId, t.createdAt)],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
