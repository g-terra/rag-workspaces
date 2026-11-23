import type { Site } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { displayUrl, isCrawling, parseExcludePaths, siteProgress, siteStatusLabel, siteTone } from './sites';

const site = (over: Partial<Site> = {}): Site => ({
  id: 'site_1',
  workspace: 'docs',
  folderId: null,
  startUrl: 'https://auth0.com/docs',
  scope: 'https://auth0.com/docs/',
  excludePaths: [],
  maxPages: 1000,
  maxDepth: 10,
  status: 'ready',
  pages: { found: 0, fetched: 0, new: 0, changed: 0, unchanged: 0, removed: 0, failed: 0 },
  documentCount: 0,
  lastError: null,
  crawledAt: null,
  createdAt: '2026-11-23T10:00:00Z',
  updatedAt: '2026-11-23T10:00:00Z',
  ...over,
});
const pages = (p: Partial<Site['pages']>) => ({ ...site().pages, ...p });

describe('sites', () => {
  it('tells a crawl in progress', () => {
    expect(isCrawling(site({ status: 'queued' }))).toBe(true);
    expect(isCrawling(site({ status: 'crawling' }))).toBe(true);
    expect(isCrawling(site({ status: 'ready' }))).toBe(false);
    expect(isCrawling(site({ status: 'failed' }))).toBe(false);
  });

  it('maps status to a badge', () => {
    expect([siteTone(site({ status: 'crawling' })), siteStatusLabel(site({ status: 'crawling' }))]).toEqual([
      'processing',
      'Crawling',
    ]);
    expect(siteTone(site({ status: 'failed' }))).toBe('failed');
  });

  it('describes progress, leaving out zero counts', () => {
    expect(siteProgress(site({ status: 'queued' }))).toBe('Waiting to start');
    expect(
      siteProgress(
        site({ status: 'crawling', pages: pages({ found: 2311, fetched: 340, new: 338, failed: 2 }) }),
      ),
    ).toBe('Fetched 340 of 2,311 found · 338 new · 2 failed');
    expect(siteProgress(site({ pages: pages({ found: 3, fetched: 3, unchanged: 2, removed: 1 }) }))).toBe(
      '3 fetched · 2 unchanged · 1 removed',
    );
  });

  it('shows URLs without the scheme', () => {
    expect(displayUrl('https://auth0.com/docs/')).toBe('auth0.com/docs');
    expect(displayUrl('http://docs.example.org/guide/intro')).toBe('docs.example.org/guide/intro');
  });

  it('parses excluded paths', () => {
    expect(parseExcludePaths(' /docs/fr-ca/\n/docs/ja-jp/, /docs/fr-ca/ \n\n')).toEqual({
      paths: ['/docs/fr-ca/', '/docs/ja-jp/'],
    });
    expect(parseExcludePaths('')).toEqual({ paths: [] });
    expect(parseExcludePaths('fr-ca/')).toEqual({ error: expect.stringMatching(/"fr-ca\/" must start/) });
  });
});
