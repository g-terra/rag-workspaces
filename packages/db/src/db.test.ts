import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './client.js';
import { newId } from './ids.js';
import { documents, sites, workspaces } from './schema.js';
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

  it('deduplicates uploads per workspace but website pages per site', async () => {
    const workspaceId = newId('workspace');
    await t.db.insert(workspaces).values({ id: workspaceId, slug: 'dedup', name: 'dedup' });
    const siteId = newId('site');
    await t.db.insert(sites).values({
      id: siteId,
      workspaceId,
      startUrl: 'https://docs.example.org/guide/',
      scope: 'https://docs.example.org/guide/',
      maxPages: 10,
      maxDepth: 3,
    });
    const doc = (over: Partial<typeof documents.$inferInsert> = {}) => {
      const id = newId('document');
      return {
        id,
        workspaceId,
        title: 't',
        fileName: 'f.md',
        type: 'md' as const,
        sizeBytes: 1,
        sha256: 'same',
        storagePath: `dedup/${id}.md`,
        ...over,
      };
    };
    await t.db.insert(documents).values(doc());
    await expect(t.db.insert(documents).values(doc())).rejects.toThrow();
    // A page with the same content as an upload is kept, so it can be cited by its URL.
    const page = { type: 'web' as const, siteId, sourceUrl: 'https://docs.example.org/guide/a' };
    await t.db.insert(documents).values(doc(page));
    await expect(
      t.db.insert(documents).values(doc({ ...page, sourceUrl: 'https://docs.example.org/guide/b' })),
    ).rejects.toThrow();
    await expect(t.db.insert(documents).values(doc({ ...page, sha256: 'other' }))).rejects.toThrow();
  });
});
