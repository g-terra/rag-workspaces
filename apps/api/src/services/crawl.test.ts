import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { documents, folders, newId, sites, workspaces, type Database, type Site } from '@rag/db';
import { createTestDatabase } from '@rag/db/testing';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { ChromaService } from './chroma.js';
import { Crawler } from './crawl.js';
import { DocumentEvents } from './document-events.js';
import { UploadStorage } from './storage.js';
import type { FetchedPage, PageFetcher, SiteMap } from './web-fetch.js';

const url = process.env.TEST_DATABASE_URL;
const log = pino({ level: 'silent' });
const ROOT = 'https://docs.example.org/guide/';

/** A pretend website: URL → page. Anything missing answers 404. */
type FakeSite = Record<string, Partial<FetchedPage>>;

function page(
  markdown: string,
  links: string[] = [],
  extra: Partial<FetchedPage> = {},
): Partial<FetchedPage> {
  return { status: 200, markdown, links, title: markdown.split('\n')[0]!.replace(/^#\s*/, ''), ...extra };
}

class FakeFetcher implements PageFetcher {
  site: FakeSite = {};
  map: SiteMap = { urls: [], crawlDelay: null, hasLlmsTxt: false };
  fetched: { url: string; preferMarkdown: boolean; wantLinks: boolean }[] = [];
  /** Throw instead of answering, as when Langflow is down. */
  down = false;

  async page(url: string, opts: { preferMarkdown: boolean; wantLinks: boolean }): Promise<FetchedPage> {
    this.fetched.push({ url, ...opts });
    if (this.down) throw new Error('Langflow: connect ECONNREFUSED');
    const found = this.site[url];
    return {
      url,
      finalUrl: url,
      status: 404,
      title: '',
      markdown: '',
      links: [],
      canonical: null,
      blocked: false,
      skipped: null,
      error: null,
      ...found,
    };
  }

  async sitemap(): Promise<SiteMap> {
    if (this.down) throw new Error('Langflow: connect ECONNREFUSED');
    return this.map;
  }
}

describe.skipIf(!url)('crawler (against TEST_DATABASE_URL)', () => {
  let t: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: Database;
  let root: string;
  let storage: UploadStorage;
  let workspaceId: string;
  const fetcher = new FakeFetcher();
  const queued: string[] = [];
  const sleeps: number[] = [];
  const vectorDeletes: string[] = [];
  const events = new DocumentEvents();
  const removedEvents: string[] = [];
  events.subscribe((e) => e.removed && removedEvents.push(e.document.id));
  const chroma = new ChromaService({ CHROMA_URL: 'http://chroma:8000' }, (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (String(input).endsWith('/delete'))
      vectorDeletes.push(JSON.parse(String(init?.body)).where.document_id);
    return new Response(JSON.stringify({ id: 'cid' }));
  }) as typeof fetch);
  let crawler: Crawler;

  beforeAll(async () => {
    t = await createTestDatabase(url!);
    db = t.db;
    root = await mkdtemp(path.join(tmpdir(), 'crawl-'));
    storage = new UploadStorage(root, 1_000_000);
    workspaceId = newId('workspace');
    await db.insert(workspaces).values({ id: workspaceId, slug: 'docs', name: 'Docs' });
    crawler = new Crawler({
      db,
      storage,
      fetcher,
      chroma,
      events,
      ingest: { enqueue: async (id) => void queued.push(id) },
      config: loadConfig({ NODE_ENV: 'test', CRAWL_DELAY_MS: '5' }),
      log,
      sleep: async (ms) => void sleeps.push(ms),
    });
  });

  afterAll(async () => {
    await t?.drop();
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    fetcher.site = {};
    fetcher.map = { urls: [], crawlDelay: null, hasLlmsTxt: false };
    fetcher.fetched = [];
    fetcher.down = false;
    queued.length = 0;
    sleeps.length = 0;
    vectorDeletes.length = 0;
    removedEvents.length = 0;
  });

  async function newSite(over: Partial<typeof sites.$inferInsert> = {}): Promise<Site> {
    const id = newId('site');
    const [row] = await db
      .insert(sites)
      .values({
        id,
        workspaceId,
        startUrl: `${ROOT}?site=${id}`,
        scope: ROOT,
        maxPages: 100,
        maxDepth: 10,
        ...over,
      })
      .returning();
    return row!;
  }
  const siteRow = async (id: string) => (await db.select().from(sites).where(eq(sites.id, id)))[0]!;
  const pagesOf = async (siteId: string) =>
    (await db.select().from(documents).where(eq(documents.siteId, siteId))).sort((a, b) =>
      a.sourceUrl!.localeCompare(b.sourceUrl!),
    );
  /** Mark a site's pages as ingested, as the ingest worker would. */
  const ingestAll = (siteId: string) =>
    db.update(documents).set({ status: 'ready', attempts: 1 }).where(eq(documents.siteId, siteId));

  it('follows links in scope breadth first and makes each page a queued web document', async () => {
    const site = await newSite({ startUrl: ROOT });
    fetcher.site = {
      [ROOT]: page('# Guide\n\nStart here.', [
        `${ROOT}install#top`,
        `${ROOT}usage?utm_source=nav`,
        'https://docs.example.org/blog/news',
        'https://elsewhere.org/guide/x',
        `${ROOT}logo.png`,
      ]),
      [`${ROOT}install`]: page('# Install\n\nRun it.', [ROOT, `${ROOT}usage`]),
      [`${ROOT}usage`]: page('# Usage\n\nUse it.'),
    };

    expect(await crawler.crawl(site.id)).toBe('ready');

    expect(fetcher.fetched.map((f) => f.url)).toEqual([ROOT, `${ROOT}install`, `${ROOT}usage`]);
    const pages = await pagesOf(site.id);
    expect(pages.map((p) => [p.sourceUrl, p.title, p.type, p.status])).toEqual([
      [ROOT, 'Guide', 'web', 'queued'],
      [`${ROOT}install`, 'Install', 'web', 'queued'],
      [`${ROOT}usage`, 'Usage', 'web', 'queued'],
    ]);
    expect(queued.sort()).toEqual(pages.map((p) => p.id).sort());
    const first = pages[0]!;
    expect(first.storagePath).toBe(`docs/${first.id}.md`);
    expect(await readFile(path.join(root, first.storagePath), 'utf8')).toBe('# Guide\n\nStart here.');
    expect(await siteRow(site.id)).toMatchObject({
      status: 'ready',
      pagesFound: 3,
      pagesFetched: 3,
      pagesNew: 3,
      pagesChanged: 0,
      pagesFailed: 0,
      lastError: null,
    });
    expect((await siteRow(site.id)).crawledAt).toBeInstanceOf(Date);
    // A pause before every request but the first.
    expect(sleeps).toEqual([5, 5]);
  });

  it('seeds from the sitemap, uses Markdown twins when there is llms.txt, and honours Crawl-delay', async () => {
    const site = await newSite();
    fetcher.map = {
      urls: [`${ROOT}a`, `${ROOT}b`, 'https://docs.example.org/other/c', `${ROOT}fr-ca/a`],
      crawlDelay: 2,
      hasLlmsTxt: true,
    };
    await db
      .update(sites)
      .set({ excludePaths: ['/guide/fr-ca/'] })
      .where(eq(sites.id, site.id));
    fetcher.site = {
      [site.startUrl]: page('# Home'),
      [`${ROOT}a`]: page('# A'),
      [`${ROOT}b`]: page('# B'),
    };

    expect(await crawler.crawl(site.id)).toBe('ready');

    expect(fetcher.fetched.map((f) => f.url)).toEqual([site.startUrl, `${ROOT}a`, `${ROOT}b`]);
    // The sitemap lists the site, so links are not needed and the Markdown twin is enough.
    expect(fetcher.fetched.every((f) => f.preferMarkdown && !f.wantLinks)).toBe(true);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it('stops at maxPages and at maxDepth', async () => {
    const site = await newSite({ maxPages: 2 });
    fetcher.site = {
      [site.startUrl]: page('# 0', [`${ROOT}1`, `${ROOT}2`, `${ROOT}3`]),
      [`${ROOT}1`]: page('# 1'),
      [`${ROOT}2`]: page('# 2'),
    };
    await crawler.crawl(site.id);
    expect(fetcher.fetched).toHaveLength(2);

    const deep = await newSite({ maxDepth: 2 });
    fetcher.fetched = [];
    fetcher.site = {
      [deep.startUrl]: page('# d0', [`${ROOT}d1`]),
      [`${ROOT}d1`]: page('# d1', [`${ROOT}d2`]),
      [`${ROOT}d2`]: page('# d2'),
    };
    await crawler.crawl(deep.id);
    expect(fetcher.fetched.map((f) => f.url)).toEqual([deep.startUrl, `${ROOT}d1`]);
    // The last level is fetched without asking for its links.
    expect(fetcher.fetched[1]!.wantLinks).toBe(false);
  });

  it('treats a canonical URL and duplicate content as one page', async () => {
    const site = await newSite();
    fetcher.site = {
      [site.startUrl]: page('# Home', [`${ROOT}index.html`, `${ROOT}copy`], { canonical: ROOT }),
      [`${ROOT}index.html`]: page('# Home', [], { canonical: ROOT }),
      [`${ROOT}copy`]: page('# Home'),
    };
    await crawler.crawl(site.id);
    const pages = await pagesOf(site.id);
    expect(pages.map((p) => p.sourceUrl)).toEqual([ROOT]);
    expect((await siteRow(site.id)).pagesNew).toBe(1);
  });

  it('puts new pages in the site folder', async () => {
    const folderId = newId('folder');
    await db.insert(folders).values({ id: folderId, workspaceId, name: 'Guide' });
    const site = await newSite({ folderId });
    fetcher.site = { [site.startUrl]: page('# In a folder') };
    await crawler.crawl(site.id);
    expect((await pagesOf(site.id))[0]!.folderId).toBe(folderId);
  });

  it('fails the crawl when the start page cannot be read, and keeps what it had', async () => {
    const site = await newSite();
    fetcher.site = { [site.startUrl]: page('# Home', [`${ROOT}kept`]), [`${ROOT}kept`]: page('# Kept') };
    await crawler.crawl(site.id);
    await ingestAll(site.id);

    fetcher.site = {};
    expect(await crawler.crawl(site.id)).toBe('failed');
    expect(await siteRow(site.id)).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/404/),
    });
    expect(await pagesOf(site.id)).toHaveLength(2);

    fetcher.site = { [site.startUrl]: page('# Home', [], { blocked: true }) };
    expect(await crawler.crawl(site.id)).toBe('failed');
    expect((await siteRow(site.id)).lastError).toMatch(/robots\.txt/);
  });

  it('fails the crawl when Langflow is down, without removing anything', async () => {
    const site = await newSite();
    fetcher.site = { [site.startUrl]: page('# Home') };
    await crawler.crawl(site.id);
    await ingestAll(site.id);
    fetcher.down = true;
    expect(await crawler.crawl(site.id)).toBe('failed');
    expect((await siteRow(site.id)).lastError).toMatch(/ECONNREFUSED/);
    expect(await pagesOf(site.id)).toHaveLength(1);
    expect(vectorDeletes).toEqual([]);
  });

  it('counts page errors and goes on', async () => {
    const site = await newSite();
    fetcher.site = {
      [site.startUrl]: page('# Home', [`${ROOT}broken`, `${ROOT}image`, `${ROOT}ok`]),
      [`${ROOT}broken`]: { status: 0, error: 'ReadTimeout' },
      [`${ROOT}image`]: { status: 200, skipped: 'image/png' },
      [`${ROOT}ok`]: page('# OK'),
    };
    expect(await crawler.crawl(site.id)).toBe('ready');
    expect(await siteRow(site.id)).toMatchObject({
      pagesFailed: 1,
      pagesNew: 2,
      lastError: expect.stringMatching(/ReadTimeout/),
    });
  });

  describe('crawling again', () => {
    it('re-ingests changed pages only and removes pages that are gone', async () => {
      const site = await newSite();
      fetcher.site = {
        [site.startUrl]: page('# Home', [`${ROOT}same`, `${ROOT}edit`, `${ROOT}gone`]),
        [`${ROOT}same`]: page('# Same'),
        [`${ROOT}edit`]: page('# Edit v1'),
        [`${ROOT}gone`]: page('# Gone'),
      };
      await crawler.crawl(site.id);
      await ingestAll(site.id);
      const before = await pagesOf(site.id);
      const byUrl = (u: string) => before.find((p) => p.sourceUrl === u)!;
      queued.length = 0;

      fetcher.site = {
        [site.startUrl]: page('# Home', [`${ROOT}same`, `${ROOT}edit`, `${ROOT}gone`]),
        [`${ROOT}same`]: page('# Same'),
        [`${ROOT}edit`]: page('# Edit v2'),
      };
      expect(await crawler.crawl(site.id)).toBe('ready');

      expect(queued).toEqual([byUrl(`${ROOT}edit`).id]);
      const after = await pagesOf(site.id);
      expect(after.map((p) => p.sourceUrl)).toEqual([site.startUrl, `${ROOT}edit`, `${ROOT}same`]);
      const edited = after.find((p) => p.sourceUrl === `${ROOT}edit`)!;
      expect(edited).toMatchObject({ status: 'queued', attempts: 0, title: 'Edit v2', passageCount: null });
      expect(await readFile(path.join(root, edited.storagePath), 'utf8')).toBe('# Edit v2');
      expect(vectorDeletes).toEqual([byUrl(`${ROOT}gone`).id]);
      expect(removedEvents).toEqual([byUrl(`${ROOT}gone`).id]);
      expect(await siteRow(site.id)).toMatchObject({
        pagesNew: 0,
        pagesChanged: 1,
        pagesUnchanged: 2,
        pagesRemoved: 1,
      });
    });

    it('removes a page robots.txt now disallows', async () => {
      const site = await newSite();
      fetcher.site = { [site.startUrl]: page('# Home', [`${ROOT}p`]), [`${ROOT}p`]: page('# P') };
      await crawler.crawl(site.id);
      await ingestAll(site.id);
      fetcher.site[`${ROOT}p`] = { blocked: true };
      await crawler.crawl(site.id);
      expect((await pagesOf(site.id)).map((p) => p.sourceUrl)).toEqual([site.startUrl]);
    });

    it('keeps unreached pages when the crawl stopped at maxPages or most fetches failed', async () => {
      const site = await newSite();
      fetcher.site = {
        [site.startUrl]: page('# Home', [`${ROOT}x`, `${ROOT}y`]),
        [`${ROOT}x`]: page('# X'),
        [`${ROOT}y`]: page('# Y'),
      };
      await crawler.crawl(site.id);
      await ingestAll(site.id);

      await db.update(sites).set({ maxPages: 1 }).where(eq(sites.id, site.id));
      await crawler.crawl(site.id);
      expect(await pagesOf(site.id)).toHaveLength(3);

      await db.update(sites).set({ maxPages: 100 }).where(eq(sites.id, site.id));
      fetcher.site = {
        [site.startUrl]: page('# Home', [`${ROOT}x`, `${ROOT}y`]),
        [`${ROOT}x`]: { status: 503 },
        [`${ROOT}y`]: { status: 0, error: 'ConnectTimeout' },
      };
      await crawler.crawl(site.id);
      expect(await pagesOf(site.id)).toHaveLength(3);
      expect(vectorDeletes).toEqual([]);
    });

    it('leaves a page alone while it is being ingested', async () => {
      const site = await newSite();
      fetcher.site = { [site.startUrl]: page('# Home', [`${ROOT}busy`]), [`${ROOT}busy`]: page('# Busy v1') };
      await crawler.crawl(site.id);
      await ingestAll(site.id);
      const busy = (await pagesOf(site.id)).find((p) => p.sourceUrl === `${ROOT}busy`)!;
      await db.update(documents).set({ status: 'processing' }).where(eq(documents.id, busy.id));
      queued.length = 0;

      fetcher.site[`${ROOT}busy`] = page('# Busy v2');
      await crawler.crawl(site.id);
      const after = (await pagesOf(site.id)).find((p) => p.sourceUrl === `${ROOT}busy`)!;
      expect(after).toMatchObject({ status: 'processing', title: 'Busy v1', sha256: busy.sha256 });
      expect(queued).toEqual([]);

      delete fetcher.site[`${ROOT}busy`];
      fetcher.site[site.startUrl] = page('# Home');
      await crawler.crawl(site.id);
      expect((await pagesOf(site.id)).map((p) => p.sourceUrl)).toContain(`${ROOT}busy`);
    });

    it('removes a page whose new content duplicates another page of the site', async () => {
      const site = await newSite();
      fetcher.site = {
        [site.startUrl]: page('# Home', [`${ROOT}a`, `${ROOT}b`]),
        [`${ROOT}a`]: page('# A'),
        [`${ROOT}b`]: page('# B'),
      };
      await crawler.crawl(site.id);
      await ingestAll(site.id);
      fetcher.site[`${ROOT}b`] = page('# A');
      await crawler.crawl(site.id);
      expect((await pagesOf(site.id)).map((p) => p.sourceUrl)).toEqual([site.startUrl, `${ROOT}a`]);
    });
  });

  it('waits while the workspace is being reindexed', async () => {
    const site = await newSite();
    await db.update(workspaces).set({ status: 'reindexing' }).where(eq(workspaces.id, workspaceId));
    try {
      expect(await crawler.crawl(site.id)).toBe('retry');
      expect(fetcher.fetched).toEqual([]);
    } finally {
      await db.update(workspaces).set({ status: 'active' }).where(eq(workspaces.id, workspaceId));
    }
  });

  it('puts sites left crawling back in the queue after a restart', async () => {
    const stuck = await newSite({ status: 'crawling' });
    const waiting = await newSite({ status: 'queued' });
    const ids = await crawler.recover();
    expect(ids).toEqual(expect.arrayContaining([stuck.id, waiting.id]));
    expect((await siteRow(stuck.id)).status).toBe('queued');
  });

  it('is gone when the site was deleted', async () => {
    expect(await crawler.crawl('site_missing')).toBe('gone');
  });
});
