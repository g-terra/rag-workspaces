import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './client.js';
import { newId } from './ids.js';
import { workspaces } from './schema.js';
import { createTestDatabase } from './testing.js';

// Needs a throwaway Postgres: CI provides one; locally run
//   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test postgres:16.16-alpine
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres pnpm --filter @rag/db test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('database (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    await runMigrations(t.url); // a second run is a no-op
  });

  afterAll(() => t.drop());

  it('answers a ping', async () => {
    await expect(t.ping()).resolves.toBeUndefined();
  });

  it('stores a workspace with defaults', async () => {
    const id = newId('workspace');
    await t.db.insert(workspaces).values({ id, slug: 'ouc', name: 'OUC study material' });
    const [row] = await t.db.select().from(workspaces).where(eq(workspaces.id, id));
    expect(row).toMatchObject({ slug: 'ouc', status: 'active', settings: {}, description: null });
    expect(row!.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate slug', async () => {
    await expect(
      t.db.insert(workspaces).values({ id: newId('workspace'), slug: 'ouc', name: 'again' }),
    ).rejects.toThrow();
  });
});
