import { sql } from 'drizzle-orm';
import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
