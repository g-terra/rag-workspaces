import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDb, runMigrations } from './client.js';

/**
 * A fresh, migrated database for one test file, created next to TEST_DATABASE_URL and
 * dropped by `drop()`. Test files run in parallel, so each gets its own database.
 */
export async function createTestDatabase(baseUrl: string) {
  const name = `test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  const conn = createDb(url.toString(), { max: 4 });
  return {
    ...conn,
    url: url.toString(),
    drop: async () => {
      await conn.close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}
