/**
 * Which URLs belong to an imported website. Pure functions, used by the crawler (crawl.ts) on every
 * link a fetched page returns.
 */

/** Query parameters that only track where a click came from; dropping them merges duplicate URLs. */
const TRACKING = /^(utm_\w+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref|ref_src)$/i;

/** Extensions of files that are not pages. Anything else (no extension, .html, .md) is a candidate. */
const NOT_PAGES = new Set(
  (
    'png jpg jpeg gif webp avif svg ico bmp tif tiff pdf zip gz tgz tar rar 7z dmg exe msi deb rpm ' +
    'css js mjs map json xml rss atom txt csv woff woff2 ttf otf eot mp4 webm mov avi mp3 wav ogg ' +
    'm4a wasm bin iso apk'
  ).split(' '),
);

/** Extensions that make a start URL's last segment a page file rather than a directory. */
const PAGE_FILES = /\.(html?|php|aspx?|jsp|md)$/i;

/**
 * The URL prefix every page of the site must start with: the start URL's directory. A start URL
 * without a trailing slash counts as a directory (`https://auth0.com/docs` → `https://auth0.com/docs/`)
 * unless its last segment is a page file (`/guide/index.html` → `/guide/`). Other dots are part of a
 * directory name (`/docs/v2.1` → `/docs/v2.1/`).
 */
export function scopeOf(startUrl: string): string {
  const u = new URL(startUrl);
  u.search = '';
  u.hash = '';
  if (!u.pathname.endsWith('/')) {
    const last = u.pathname.slice(u.pathname.lastIndexOf('/') + 1);
    u.pathname = PAGE_FILES.test(last) ? u.pathname.slice(0, -last.length) : `${u.pathname}/`;
  }
  return u.toString();
}

/**
 * A link as the crawler compares it: absolute, http(s), without fragment or tracking parameters,
 * host lower-cased and default port dropped (the URL class does both). Null when it is not a web link.
 */
export function normalizeUrl(href: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  if (!u.searchParams.size) u.search = '';
  return u.toString();
}

/** Whether a normalized URL is part of the site: under the scope (the scope's own page too) and not excluded. */
export function inScope(url: string, scope: string, excludePaths: readonly string[]): boolean {
  const bare = url.split('?')[0]!;
  if (!bare.startsWith(scope) && `${bare}/` !== scope) return false;
  const path = new URL(url).pathname;
  return !excludePaths.some((p) => path.startsWith(p) || `${path}/` === p);
}

/** False for links to images, archives, scripts and other files that are not pages. */
export function looksLikePage(url: string): boolean {
  const path = new URL(url).pathname;
  const last = path.slice(path.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  if (dot < 0) return true;
  return !NOT_PAGES.has(last.slice(dot + 1).toLowerCase());
}
