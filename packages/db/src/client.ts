import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import * as schema from './schema.js';

/** The migrations folder, shipped next to dist/ in this package. */
const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

export type Database = ReturnType<typeof createDb>['db'];

export function createDb(url: string, opts: { max?: number } = {}) {
  const sqlClient = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  const db = drizzle(sqlClient, { schema, casing: 'snake_case' });
  return {
    db,
    /** Resolve when Postgres answers a trivial query. */
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => sqlClient.end({ timeout: 5 }),
  };
}

/**
 * Apply every migration in drizzle/ that has not run yet. Safe to call on every start:
 * drizzle records applied migrations in `drizzle.__drizzle_migrations` and takes a lock,
 * so a second caller waits instead of applying twice.
 */
export async function runMigrations(url: string): Promise<void> {
  const sqlClient = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sqlClient), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}
