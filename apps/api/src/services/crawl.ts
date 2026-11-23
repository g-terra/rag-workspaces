import { documents, newId, sites, workspaces, type Database, type Document, type Site } from '@rag/db';
import { and, eq, notInArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { PgBoss } from 'pg-boss';
import type { Config } from '../config.js';
import { ChromaService } from './chroma.js';
import { inScope, looksLikePage, normalizeUrl } from './crawl-scope.js';
import type { DocumentEvents } from './document-events.js';
import type { IngestQueue } from './ingest-queue.js';
import { pagePath, sha256, type UploadStorage } from './storage.js';
import type { FetchedPage, PageFetcher } from './web-fetch.js';

export type CrawlDeps = {
  db: Database;
  storage: UploadStorage;
  fetcher: PageFetcher;
  chroma: ChromaService;
  events: DocumentEvents;
  /** Where new and changed pages go to be ingested. */
  ingest: IngestQueue;
  config: Pick<Config, 'CRAWL_DELAY_MS' | 'CRAWL_FETCH_TIMEOUT_MS'>;
  log: FastifyBaseLogger;
  /** Waits between requests; tests pass one that only records. */
  sleep?: (ms: number) => Promise<void>;
};

export type CrawlOutcome = 'ready' | 'failed' | 'retry' | 'gone';

/** A document that may be read by an ingest run right now; the crawler never touches its file. */
const BUSY = ['queued', 'transcribing', 'processing'] as const;
const isBusy = (d: Document) => (BUSY as readonly string[]).includes(d.status);
/** robots.txt's Crawl-delay is honoured up to this; a site asking for more is still crawled, slowly. */
const MAX_DELAY_MS = 30_000;
/** This many fetches in a row that never reached the page (Langflow down) end the crawl. */
const MAX_FETCH_ERRORS_IN_A_ROW = 5;
/** Reading a large sitemap index (auth0.com/docs lists about 7,000 pages) takes far longer than a page. */
const SITEMAP_TIMEOUT_MS = 5 * 60_000;

class CrawlFailed extends Error {}

type Counters = {
  pagesFound: number;
  pagesFetched: number;
  pagesNew: number;
  pagesChanged: number;
  pagesUnchanged: number;
  pagesRemoved: number;
  pagesFailed: number;
  lastError: string | null;
};

/**
 * Crawls one imported website (docs/specs/2026-11-23-docs-website-import.md). The API keeps the
 * frontier, the scope, the limits and the pacing; every request to the site goes through the
 * `rw-fetch` flow (decision 18), which returns the page as Markdown with its links.
 *
 * - Breadth first from the start URL, plus the sitemap's pages in scope and every page the site already
 *   has. Links are followed up to `maxDepth` levels (not at all when a complete sitemap lists the
 *   site); the crawl stops after `maxPages` fetches.
 * - A page is a document of type `web`, saved as `<slug>/<id>.md` and ingested by the usual queue.
 *   Unchanged content (same SHA-256) is not re-ingested; changed content is, after its file is replaced.
 *   Content another page of the site already has is not stored twice.
 * - A page is removed only when it answers 404 or 410, when robots.txt now disallows it, or when it is
 *   no longer in the site's scope (`excludePaths` changed). A page that errors or was not reached keeps
 *   what it had.
 * - A page waiting for or under ingestion is left alone; the next crawl picks up any change.
 * - The frontier lives in memory: after a restart the crawl starts over, and unchanged pages cost
 *   one fetch each.
 */
export class Crawler {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: CrawlDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async crawl(siteId: string): Promise<CrawlOutcome> {
    const { db, log } = this.deps;
    const [row] = await db
      .select({ site: sites, workspace: workspaces })
      .from(sites)
      .innerJoin(workspaces, eq(workspaces.id, sites.workspaceId))
      .where(eq(sites.id, siteId));
    if (!row) return 'gone';
    const { site, workspace } = row;
    // A reindex drops and refills the collection; new pages would race it. Try again later.
    if (workspace.status === 'reindexing') return 'retry';

    const counters: Counters = {
      pagesFound: 0,
      pagesFetched: 0,
      pagesNew: 0,
      pagesChanged: 0,
      pagesUnchanged: 0,
      pagesRemoved: 0,
      pagesFailed: 0,
      lastError: null,
    };
    if (!(await this.save(site.id, { status: 'crawling', ...counters }))) return 'gone';
    log.info({ siteId, startUrl: site.startUrl }, 'crawl started');
    const run = new CrawlRun(this.deps, this.sleep, site, workspace.slug, counters, (c) =>
      this.save(site.id, c),
    );
    try {
      await run.go();
      await this.save(site.id, { ...counters, status: 'ready', crawledAt: new Date() });
      log.info({ siteId, ...counters }, 'crawl finished');
      return 'ready';
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.save(site.id, { ...counters, status: 'failed', lastError: reason, crawledAt: new Date() });
      log.warn({ siteId, reason }, 'crawl failed');
      return 'failed';
    }
  }

  /** After a restart: sites left mid-crawl go back to `queued`. Returns every queued site id. */
  async recover(): Promise<string[]> {
    const { db } = this.deps;
    await db.update(sites).set({ status: 'queued' }).where(eq(sites.status, 'crawling'));
    const queued = await db.select({ id: sites.id }).from(sites).where(eq(sites.status, 'queued'));
    return queued.map((s) => s.id);
  }

  private async save(id: string, set: Partial<Site>) {
    const [row] = await this.deps.db
      .update(sites)
      .set(set)
      .where(eq(sites.id, id))
      .returning({ id: sites.id });
    return row;
  }
}

/** The state of one crawl of one site. */
class CrawlRun {
  private readonly frontier: { url: string; depth: number }[] = [];
  /** Every URL queued or fetched, normalized. */
  private readonly seen = new Set<string>();
  /** The site's documents by page URL, as the crawl found them and as it changes them. */
  private readonly byUrl = new Map<string, Document>();
  /** Page URLs stored (or found unchanged) in this crawl. */
  private readonly stored = new Set<string>();
  private delayMs: number;
  private preferMarkdown = false;
  /** A complete sitemap lists the site's pages, so links are not needed. */
  private sitemapCovers = false;
  private errorsInARow = 0;

  constructor(
    private readonly deps: CrawlDeps,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly site: Site,
    private readonly slug: string,
    private readonly counters: Counters,
    private readonly progress: (c: Counters) => Promise<unknown>,
  ) {
    this.delayMs = deps.config.CRAWL_DELAY_MS;
  }

  async go(): Promise<void> {
    const { db, fetcher, log } = this.deps;
    const known = await db.select().from(documents).where(eq(documents.siteId, this.site.id));
    for (const d of known) if (d.sourceUrl) this.byUrl.set(d.sourceUrl, d);

    this.enqueue(normalizeUrl(this.site.startUrl, this.site.startUrl)!, 0);
    try {
      const map = await fetcher.sitemap(this.site.scope, AbortSignal.timeout(SITEMAP_TIMEOUT_MS));
      this.preferMarkdown = map.hasLlmsTxt;
      if (map.crawlDelay)
        this.delayMs = Math.min(Math.max(this.delayMs, map.crawlDelay * 1000), MAX_DELAY_MS);
      let listed = false;
      for (const u of map.urls) {
        const n = normalizeUrl(u, this.site.scope);
        if (n && this.enqueue(n, 0)) listed = true;
      }
      this.sitemapCovers = listed && map.complete;
    } catch (err) {
      // Without the sitemap the crawl follows links instead; the start page decides whether it can go on.
      const reason = `Could not read the sitemap: ${err instanceof Error ? err.message : String(err)}`;
      this.counters.lastError = reason;
      log.warn({ siteId: this.site.id, reason }, 'sitemap not read');
    }
    // Pages the site already has are fetched again even when nothing links to them any more.
    for (const d of known) {
      if (!d.sourceUrl) continue;
      if (inScope(d.sourceUrl, this.site.scope, this.site.excludePaths)) this.enqueue(d.sourceUrl, 0);
      else await this.remove(d);
    }

    let first = true;
    while (this.frontier.length && this.counters.pagesFetched < this.site.maxPages) {
      const { url, depth } = this.frontier.shift()!;
      if (!first) await this.sleep(this.delayMs);
      const page = await this.fetch(url, depth);
      this.counters.pagesFetched++;
      await this.handle(url, depth, page, first);
      first = false;
      await this.progress(this.counters);
    }
  }

  /** Queue a normalized URL when it is in scope, looks like a page and is new. */
  private enqueue(url: string, depth: number): boolean {
    if (this.seen.has(url) || depth >= this.site.maxDepth) return false;
    if (!inScope(url, this.site.scope, this.site.excludePaths) || !looksLikePage(url)) return false;
    this.seen.add(url);
    this.frontier.push({ url, depth });
    this.counters.pagesFound++;
    return true;
  }

  private async fetch(url: string, depth: number): Promise<FetchedPage> {
    const wantLinks = !this.sitemapCovers && depth + 1 < this.site.maxDepth;
    try {
      const page = await this.deps.fetcher.page(
        url,
        { preferMarkdown: this.preferMarkdown, wantLinks },
        AbortSignal.timeout(this.deps.config.CRAWL_FETCH_TIMEOUT_MS),
      );
      this.errorsInARow = 0;
      return page;
    } catch (err) {
      const reason = `Could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`;
      if (++this.errorsInARow >= MAX_FETCH_ERRORS_IN_A_ROW || this.counters.pagesFetched === 0)
        throw new CrawlFailed(reason);
      return {
        url,
        finalUrl: url,
        status: 0,
        title: '',
        markdown: '',
        links: [],
        canonical: null,
        blocked: false,
        skipped: null,
        error: reason,
      };
    }
  }

  private async handle(url: string, depth: number, page: FetchedPage, isStart: boolean): Promise<void> {
    const known = this.byUrl.get(url);
    if (page.blocked) {
      if (isStart) throw new CrawlFailed(`robots.txt disallows the start URL ${url}.`);
      if (known) await this.remove(known);
      return;
    }
    if (page.status === 404 || page.status === 410) {
      if (isStart) throw new CrawlFailed(`The start URL ${url} answered ${page.status}.`);
      if (known) await this.remove(known);
      return;
    }
    if (page.error || page.status >= 400 || (!page.skipped && !page.markdown.trim())) {
      const reason = page.error ?? (page.status >= 400 ? `HTTP ${page.status}` : 'no text on the page');
      if (isStart) throw new CrawlFailed(`The start URL ${url} could not be read: ${reason}.`);
      return this.failed(url, reason);
    }
    if (page.skipped) return;

    // A redirect that leaves the site is not followed: the page keeps what it had.
    const landed = page.finalUrl ? normalizeUrl(page.finalUrl, url) : url;
    if (!landed || !inScope(landed, this.site.scope, this.site.excludePaths)) {
      const reason = `redirected outside the site, to ${page.finalUrl}`;
      if (isStart) throw new CrawlFailed(`The start URL ${url} was ${reason}.`);
      return this.failed(url, reason);
    }

    for (const href of page.links) {
      const n = normalizeUrl(href, landed);
      if (n) this.enqueue(n, depth + 1);
    }

    // One document per page: its canonical URL when that is in the site (one outside is ignored), else
    // where redirects ended.
    const canonical = page.canonical && normalizeUrl(page.canonical, landed);
    const pageUrl =
      canonical && inScope(canonical, this.site.scope, this.site.excludePaths) ? canonical : landed;
    if (pageUrl !== url) {
      if (this.stored.has(pageUrl)) return; // already handled under that URL in this crawl
      this.seen.add(pageUrl);
    }
    await this.store(pageUrl, page);
  }

  private failed(url: string, reason: string): void {
    this.counters.pagesFailed++;
    this.counters.lastError = `${url}: ${reason}`;
  }

  private async store(pageUrl: string, page: FetchedPage): Promise<void> {
    const { db, storage, events, ingest } = this.deps;
    this.stored.add(pageUrl);
    const markdown = page.markdown.trim();
    const hash = sha256(markdown);
    const sizeBytes = Buffer.byteLength(markdown, 'utf8');
    const title = (page.title || new URL(pageUrl).pathname).slice(0, 200);
    const existing = this.byUrl.get(pageUrl);
    // Content another page of the site already has is not stored twice (pages are unique per site
    // by SHA-256). A known page that now duplicates another keeps its old content until it differs.
    const twin = [...this.byUrl.values()].some((d) => d.sha256 === hash && d.id !== existing?.id);

    if (existing) {
      if (existing.sha256 === hash || isBusy(existing) || twin) {
        this.counters.pagesUnchanged++;
        return;
      }
      // Claim the row first, so an ingest run never reads a file that does not match its row.
      const [doc] = await db
        .update(documents)
        .set({
          title,
          sha256: hash,
          sizeBytes,
          status: 'queued',
          attempts: 0,
          error: null,
          passageCount: null,
        })
        .where(and(eq(documents.id, existing.id), notInArray(documents.status, [...BUSY])))
        .returning();
      if (!doc) return; // deleted or claimed meanwhile
      try {
        await storage.writePage(this.slug, doc.id, markdown);
      } catch (err) {
        // Put the row back as it was: the old file is still in place.
        await db
          .update(documents)
          .set({
            title: existing.title,
            sha256: existing.sha256,
            sizeBytes: existing.sizeBytes,
            status: existing.status,
            attempts: existing.attempts,
            error: existing.error,
            passageCount: existing.passageCount,
          })
          .where(eq(documents.id, doc.id));
        return this.failed(pageUrl, `could not save the page: ${err instanceof Error ? err.message : err}`);
      }
      this.byUrl.set(pageUrl, doc);
      events.emit({ workspaceId: doc.workspaceId, document: doc });
      await ingest.enqueue(doc.id);
      this.counters.pagesChanged++;
      return;
    }

    if (twin) {
      this.counters.pagesUnchanged++;
      return;
    }
    const id = newId('document');
    const [doc] = await db
      .insert(documents)
      .values({
        id,
        workspaceId: this.site.workspaceId,
        folderId: this.site.folderId,
        siteId: this.site.id,
        sourceUrl: pageUrl,
        title,
        fileName: pageUrl,
        type: 'web',
        sizeBytes,
        sha256: hash,
        storagePath: pagePath(this.slug, id),
      })
      .onConflictDoNothing()
      .returning();
    if (!doc) return; // another row took this URL or content meanwhile
    try {
      await storage.writePage(this.slug, id, markdown);
    } catch (err) {
      await db.delete(documents).where(eq(documents.id, id));
      return this.failed(pageUrl, `could not save the page: ${err instanceof Error ? err.message : err}`);
    }
    this.byUrl.set(pageUrl, doc);
    events.emit({ workspaceId: doc.workspaceId, document: doc });
    await ingest.enqueue(doc.id);
    this.counters.pagesNew++;
  }

  /** Delete a page's vectors, row and file, unless an ingest run may be reading it. */
  private async remove(doc: Document): Promise<void> {
    const { db, chroma, storage, events } = this.deps;
    if (isBusy(doc)) return;
    await chroma.deleteDocumentVectors(ChromaService.collectionName(this.slug), doc.id);
    const [gone] = await db
      .delete(documents)
      .where(and(eq(documents.id, doc.id), notInArray(documents.status, [...BUSY])))
      .returning();
    if (!gone) return;
    await storage.remove(doc.storagePath);
    if (doc.sourceUrl) this.byUrl.delete(doc.sourceUrl);
    events.emit({ workspaceId: doc.workspaceId, document: doc, removed: true });
    this.counters.pagesRemoved++;
  }
}

const QUEUE = 'crawl';

/** Where sites go to be crawled. */
export interface CrawlQueue {
  enqueue(siteId: string): Promise<void>;
}

/**
 * The crawl queue on Postgres (pg-boss), separate from ingestion so pages are ingested while the
 * crawl goes on. One crawl at a time across the install: a docs site is someone else's server.
 */
export class PgBossCrawlQueue implements CrawlQueue {
  private boss: PgBoss | undefined;

  constructor(
    private readonly databaseUrl: string,
    private readonly crawler: Crawler,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start(): Promise<void> {
    const boss = new PgBoss({ connectionString: this.databaseUrl, schema: 'pgboss' });
    boss.on('error', (err) => this.log.error({ err }, 'crawl queue error'));
    await boss.start();
    await boss.createQueue(QUEUE, {
      policy: 'stately',
      // Only "the workspace is reindexing" is retried; a failed crawl is final until crawled again.
      retryLimit: 60,
      retryDelay: 60,
      // 10,000 pages at one a second, with room to spare.
      expireInSeconds: 12 * 60 * 60,
    });
    this.boss = boss;
  }

  /** Take jobs, after re-queuing sites a crash left mid-crawl. Call once Langflow is usable. */
  async startWorking(): Promise<void> {
    const boss = this.boss;
    if (!boss) throw new Error('crawl queue not started');
    for (const id of await this.crawler.recover()) await this.enqueue(id);
    await boss.work<{ siteId: string }>(QUEUE, { localConcurrency: 1, batchSize: 1 }, async ([job]) => {
      if (!job) return;
      const outcome = await this.crawler.crawl(job.data.siteId);
      if (outcome === 'retry') throw new Error(`crawl of ${job.data.siteId} waits for a workspace reindex`);
    });
  }

  async enqueue(siteId: string): Promise<void> {
    if (!this.boss) throw new Error('crawl queue not started');
    await this.boss.send(QUEUE, { siteId }, { singletonKey: siteId });
  }

  async stop(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
  }
}
