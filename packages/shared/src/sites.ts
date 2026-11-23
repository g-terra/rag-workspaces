import { z } from 'zod';
import { WorkspaceSlug } from './common.js';

export const SiteStatus = z.enum(['queued', 'crawling', 'ready', 'failed']);

/** A path prefix left out of a site's scope, such as a translation (`/docs/fr-ca/`). */
const ExcludePath = z
  .string()
  .trim()
  .regex(/^\/\S*$/, 'Start each excluded path with "/".')
  .max(300);

/** `POST /v1/workspaces/{slug}/sites`: import a documentation website. */
export const CreateSite = z
  .object({
    /** The page to start from; its directory is the scope (`https://auth0.com/docs` → `https://auth0.com/docs/`). */
    url: z
      .url({ protocol: /^https?$/, error: 'Give an http or https URL.' })
      .max(2000)
      // A user name or password in the URL would be stored and shown with the site.
      .refine((u) => {
        const parsed = URL.parse(u);
        return !parsed?.username && !parsed?.password;
      }, 'Leave the user name and password out of the URL.'),
    folderId: z.string().min(1).nullable().optional(),
    maxPages: z.number().int().min(1).max(10_000).optional(),
    maxDepth: z.number().int().min(1).max(20).optional(),
    excludePaths: z.array(ExcludePath).max(50).optional(),
  })
  .strict();
export type CreateSite = z.infer<typeof CreateSite>;

export const Site = z.object({
  id: z.string(),
  workspace: WorkspaceSlug,
  folderId: z.string().nullable(),
  startUrl: z.string(),
  /** Pages must start with this URL. */
  scope: z.string(),
  excludePaths: z.array(z.string()),
  maxPages: z.number().int(),
  maxDepth: z.number().int(),
  status: SiteStatus,
  /** Counters of the last (or the running) crawl. */
  pages: z.object({
    /** Pages queued to visit so far, sitemap entries included. */
    found: z.number().int(),
    fetched: z.number().int(),
    new: z.number().int(),
    changed: z.number().int(),
    unchanged: z.number().int(),
    removed: z.number().int(),
    failed: z.number().int(),
  }),
  /** Documents in the workspace that came from this site. */
  documentCount: z.number().int(),
  /** Why the crawl failed, or the last page error. */
  lastError: z.string().nullable(),
  /** When the last crawl finished. */
  crawledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Site = z.infer<typeof Site>;

/** `PATCH .../sites/{siteId}`: limits apply from the next crawl; a folder change moves the existing pages too. */
export const UpdateSite = z
  .object({
    folderId: z.string().min(1).nullable().optional(),
    maxPages: z.number().int().min(1).max(10_000).optional(),
    maxDepth: z.number().int().min(1).max(20).optional(),
    excludePaths: z.array(ExcludePath).max(50).optional(),
  })
  .strict();
export type UpdateSite = z.infer<typeof UpdateSite>;
