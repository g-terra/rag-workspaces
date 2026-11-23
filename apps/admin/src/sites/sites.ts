import type { Site } from '@rag/shared';
import type { Tone } from '@/documents/session';

/** A crawl is waiting or running: the list polls, and Crawl again and Remove wait. */
export const isCrawling = (s: Site) => s.status === 'queued' || s.status === 'crawling';

export const siteTone = (s: Site): Tone =>
  s.status === 'crawling' ? 'processing' : s.status === 'queued' ? 'queued' : s.status;

export function siteStatusLabel(s: Site): string {
  switch (s.status) {
    case 'queued':
      return 'Queued';
    case 'crawling':
      return 'Crawling';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
  }
}

const n = (x: number) => x.toLocaleString('en');

/**
 * One line on what the last (or current) crawl did, for example "Fetched 340 of 2,311 found · 338 new ·
 * 2 failed". Counts that are zero are left out.
 */
export function siteProgress(s: Site): string {
  const p = s.pages;
  if (s.status === 'queued' && p.fetched === 0) return 'Waiting to start';
  const parts = [
    s.status === 'crawling' ? `Fetched ${n(p.fetched)} of ${n(p.found)} found` : `${n(p.fetched)} fetched`,
  ];
  for (const [count, label] of [
    [p.new, 'new'],
    [p.changed, 'changed'],
    [p.unchanged, 'unchanged'],
    [p.removed, 'removed'],
    [p.failed, 'failed'],
  ] as const)
    if (count) parts.push(`${n(count)} ${label}`);
  return parts.join(' · ');
}

/** A URL without its scheme and trailing slash, as people read it: `auth0.com/docs`. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Paths to leave out, one per line or comma-separated as typed. Each must start with `/`; the
 * answer is the list or the first line that does not.
 */
export function parseExcludePaths(text: string): { paths: string[] } | { error: string } {
  const paths = text
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const bad = paths.find((p) => !p.startsWith('/'));
  if (bad) return { error: `"${bad}" must start with "/", for example /docs/fr-ca/.` };
  return { paths: [...new Set(paths)] };
}
