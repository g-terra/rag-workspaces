import { documents, newId, sites, type Database, type Site as SiteRow } from '@rag/db';
import { CreateSite, Site, UpdateSite, WorkspaceSlug } from '@rag/shared';
import { and, asc, count, eq, inArray, notInArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireWorkspace } from '../auth/access.js';
import { HttpProblem } from '../errors.js';
import { ChromaService } from '../services/chroma.js';
import { scopeOf } from '../services/crawl-scope.js';
import type { CrawlQueue } from '../services/crawl.js';
import type { DocumentEvents } from '../services/document-events.js';
import { requireFolder } from '../services/folders.js';
import { finishReindexIfDone } from '../services/reindex.js';
import type { UploadStorage } from '../services/storage.js';

export type SiteRoutesOptions = {
  db: Database;
  chroma: ChromaService;
  storage: UploadStorage;
  events: DocumentEvents;
  crawls: CrawlQueue;
};

/** Pages to fetch when the request does not say (sized for a large docs site such as auth0.com/docs). */
export const DEFAULT_MAX_PAGES = 1000;
export const DEFAULT_MAX_DEPTH = 10;

const SlugParams = z.object({ slug: WorkspaceSlug });
const SiteParams = SlugParams.extend({ siteId: z.string() });
const common = { tags: ['sites'], security: [{ bearerAuth: [] }] };
const BUSY_DOCS = ['transcribing', 'processing'] as const;

export const siteRoutes: FastifyPluginAsyncZod<SiteRoutesOptions> = async (app, opts) => {
  const { db, chroma, storage, events, crawls } = opts;

  const toApi = (s: SiteRow, slug: string, documentCount: number): Site => ({
    id: s.id,
    workspace: slug,
    folderId: s.folderId,
    startUrl: s.startUrl,
    scope: s.scope,
    excludePaths: s.excludePaths,
    maxPages: s.maxPages,
    maxDepth: s.maxDepth,
    status: s.status,
    pages: {
      found: s.pagesFound,
      fetched: s.pagesFetched,
      new: s.pagesNew,
      changed: s.pagesChanged,
      unchanged: s.pagesUnchanged,
      removed: s.pagesRemoved,
      failed: s.pagesFailed,
    },
    documentCount,
    lastError: s.lastError,
    crawledAt: s.crawledAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  });

  async function documentCounts(siteIds: string[]) {
    if (!siteIds.length) return new Map<string, number>();
    const rows = await db
      .select({ siteId: documents.siteId, n: count() })
      .from(documents)
      .where(inArray(documents.siteId, siteIds))
      .groupBy(documents.siteId);
    return new Map(rows.map((r) => [r.siteId!, r.n]));
  }

  async function loadSite(workspaceId: string, siteId: string) {
    const [row] = await db
      .select()
      .from(sites)
      .where(and(eq(sites.workspaceId, workspaceId), eq(sites.id, siteId)));
    if (!row) throw new HttpProblem(404, `No site ${siteId}`);
    return row;
  }

  const one = async (s: SiteRow, slug: string) =>
    toApi(s, slug, (await documentCounts([s.id])).get(s.id) ?? 0);

  app.post(
    '/v1/workspaces/:slug/sites',
    {
      schema: {
        ...common,
        summary: 'Import a documentation website',
        description:
          'Crawls the site from `url`: pages on the same host under its directory (`https://auth0.com/docs` → ' +
          '`https://auth0.com/docs/`), minus `excludePaths`, honouring robots.txt and the sitemap, at most ' +
          `\`maxPages\` (default ${DEFAULT_MAX_PAGES}) pages and \`maxDepth\` (default ${DEFAULT_MAX_DEPTH}) links deep. ` +
          'Each page becomes a document of type `web` whose `sourceUrl` is the page. The crawl runs in the ' +
          'background; poll the site for its counters. `409` when the workspace already has this start URL.',
        params: SlugParams,
        body: CreateSite,
        response: { 202: Site },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      const { url, maxPages, maxDepth, excludePaths, folderId } = req.body;
      const startUrl = new URL(url);
      startUrl.hash = '';
      const [row] = await db
        .insert(sites)
        .values({
          id: newId('site'),
          workspaceId: workspace.id,
          folderId: folderId ? await requireFolder(db, workspace.id, folderId) : null,
          startUrl: startUrl.toString(),
          scope: scopeOf(startUrl.toString()),
          excludePaths: excludePaths ?? [],
          maxPages: maxPages ?? DEFAULT_MAX_PAGES,
          maxDepth: maxDepth ?? DEFAULT_MAX_DEPTH,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new HttpProblem(409, `This workspace already imports ${startUrl.toString()}.`);
      await crawls.enqueue(row.id);
      req.log.info({ workspace: workspace.slug, siteId: row.id, startUrl: row.startUrl }, 'site added');
      return reply.status(202).send(toApi(row, workspace.slug, 0));
    },
  );

  app.get(
    '/v1/workspaces/:slug/sites',
    {
      schema: {
        ...common,
        summary: 'List imported websites',
        params: SlugParams,
        response: { 200: z.object({ data: z.array(Site) }) },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const rows = await db
        .select()
        .from(sites)
        .where(eq(sites.workspaceId, workspace.id))
        .orderBy(asc(sites.createdAt));
      const counts = await documentCounts(rows.map((r) => r.id));
      return { data: rows.map((r) => toApi(r, workspace.slug, counts.get(r.id) ?? 0)) };
    },
  );

  app.get(
    '/v1/workspaces/:slug/sites/:siteId',
    {
      schema: {
        ...common,
        summary: 'One imported website, with its crawl counters',
        params: SiteParams,
        response: { 200: Site },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      return one(await loadSite(workspace.id, req.params.siteId), workspace.slug);
    },
  );

  app.post(
    '/v1/workspaces/:slug/sites/:siteId/crawl',
    {
      schema: {
        ...common,
        summary: 'Crawl a website again',
        description:
          'Fetches every page again, including pages nothing links to any more: changed pages are ' +
          're-ingested and new ones added. A page is removed only when it answers 404 or 410, robots.txt ' +
          'disallows it, or `excludePaths` now leaves it out. Unchanged pages cost one request and no ' +
          'embedding. `409` while the site is queued or crawling.',
        params: SiteParams,
        response: { 202: Site },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      const site = await loadSite(workspace.id, req.params.siteId);
      const [row] = await db
        .update(sites)
        .set({ status: 'queued', lastError: null })
        .where(and(eq(sites.id, site.id), notInArray(sites.status, ['queued', 'crawling'])))
        .returning();
      if (!row) throw new HttpProblem(409, 'This site is already being crawled.');
      await crawls.enqueue(row.id);
      return reply.status(202).send(await one(row, workspace.slug));
    },
  );

  app.patch(
    '/v1/workspaces/:slug/sites/:siteId',
    {
      schema: {
        ...common,
        summary: 'Change a website’s limits or folder',
        description:
          'Limits apply from the next crawl. `folderId` (null: the top level) is where new pages go, and the ' +
          'existing pages move there at once; a page being ingested right now keeps its folder. `409` for a ' +
          'folder change while the site is crawling.',
        params: SiteParams,
        body: UpdateSite,
        response: { 200: Site },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      const site = await loadSite(workspace.id, req.params.siteId);
      const { folderId, ...limits } = req.body;
      // The crawl adds pages to the folder it read at its start; moving them now would split the site.
      if (folderId !== undefined && site.status === 'crawling')
        throw new HttpProblem(409, 'This site is being crawled. Move it when the crawl finishes.');
      const set: Partial<SiteRow> = { ...limits };
      if (folderId !== undefined)
        set.folderId = folderId === null ? null : await requireFolder(db, workspace.id, folderId);
      const [row] = Object.keys(set).length
        ? await db.update(sites).set(set).where(eq(sites.id, site.id)).returning()
        : [site];
      if (folderId !== undefined && row!.folderId !== site.folderId) {
        const collection = ChromaService.collectionName(workspace.slug);
        const pages = await db
          .update(documents)
          .set({ folderId: row!.folderId })
          .where(and(eq(documents.siteId, site.id), notInArray(documents.status, [...BUSY_DOCS])))
          .returning();
        for (const page of pages) {
          await chroma.setDocumentFolder(collection, page.id, page.folderId);
          events.emit({ workspaceId: workspace.id, document: page });
        }
      }
      return one(row!, workspace.slug);
    },
  );

  app.delete(
    '/v1/workspaces/:slug/sites/:siteId',
    {
      schema: {
        ...common,
        summary: 'Remove a website and all its pages',
        description:
          'Deletes the site and every document that came from it, with their vectors and files. Cannot be ' +
          'undone (add the site again to re-import it). `409` while it is crawling or one of its pages is ' +
          'being ingested.',
        params: SiteParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'editor');
      const site = await loadSite(workspace.id, req.params.siteId);
      if (site.status === 'crawling')
        throw new HttpProblem(409, 'This site is being crawled. Try again when it finishes.');
      const collection = ChromaService.collectionName(workspace.slug);
      // One transaction: rows go only when no page is being ingested, and if Chroma fails nothing is
      // deleted, so the caller can retry.
      const pages = await db.transaction(async (tx) => {
        const gone = await tx
          .delete(documents)
          .where(and(eq(documents.siteId, site.id), notInArray(documents.status, [...BUSY_DOCS])))
          .returning();
        const [left] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.siteId, site.id))
          .limit(1);
        if (left)
          throw new HttpProblem(
            409,
            'Some of this site’s pages are being ingested. Try again when they finish.',
          );
        const [removed] = await tx
          .delete(sites)
          .where(and(eq(sites.id, site.id), notInArray(sites.status, ['crawling'])))
          .returning({ id: sites.id });
        if (!removed) throw new HttpProblem(409, 'This site is being crawled. Try again when it finishes.');
        for (const p of gone) await chroma.deleteDocumentVectors(collection, p.id);
        return gone;
      });
      for (const p of pages) {
        await storage.remove(p.storagePath);
        events.emit({ workspaceId: workspace.id, document: p, removed: true });
      }
      // Deleting the last pages a reindex was waiting for finishes the reindex.
      await finishReindexIfDone(db, workspace.id);
      req.log.info({ workspace: workspace.slug, siteId: site.id, pages: pages.length }, 'site removed');
      return reply.status(204).send(null);
    },
  );
};
