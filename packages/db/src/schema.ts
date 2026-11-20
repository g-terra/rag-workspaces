import { sql } from 'drizzle-orm';
import { index, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
