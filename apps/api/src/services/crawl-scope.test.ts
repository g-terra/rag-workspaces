import { describe, expect, it } from 'vitest';
import { inScope, looksLikePage, normalizeUrl, scopeOf } from './crawl-scope.js';

describe('scopeOf', () => {
  it('treats a start URL without a trailing slash as a directory', () => {
    expect(scopeOf('https://auth0.com/docs')).toBe('https://auth0.com/docs/');
    expect(scopeOf('https://docs.example.org/guide/intro')).toBe('https://docs.example.org/guide/intro/');
  });
  it('keeps a directory and drops a file name, query and fragment', () => {
    expect(scopeOf('https://docs.example.org/guide/?x=1#top')).toBe('https://docs.example.org/guide/');
    expect(scopeOf('https://docs.example.org/guide/index.html')).toBe('https://docs.example.org/guide/');
    expect(scopeOf('https://Docs.Example.org')).toBe('https://docs.example.org/');
  });
});

describe('normalizeUrl', () => {
  const base = 'https://auth0.com/docs/get-started';
  it('resolves relative links and drops fragments and tracking parameters', () => {
    expect(normalizeUrl('quickstart#step-2', base)).toBe('https://auth0.com/docs/quickstart');
    expect(normalizeUrl('/docs/api?utm_source=x&page=2&gclid=y', base)).toBe(
      'https://auth0.com/docs/api?page=2',
    );
    expect(normalizeUrl('HTTPS://AUTH0.COM:443/docs/x', base)).toBe('https://auth0.com/docs/x');
  });
  it('refuses what is not a web page link', () => {
    expect(normalizeUrl('mailto:a@b.c', base)).toBeNull();
    expect(normalizeUrl('javascript:void(0)', base)).toBeNull();
    expect(normalizeUrl('ftp://auth0.com/x', base)).toBeNull();
    expect(normalizeUrl('http://[bad', base)).toBeNull();
  });
});

describe('inScope', () => {
  const scope = 'https://auth0.com/docs/';
  it('accepts the start page itself and pages under the scope', () => {
    expect(inScope('https://auth0.com/docs', scope, [])).toBe(true);
    expect(inScope('https://auth0.com/docs/get-started', scope, [])).toBe(true);
  });
  it('refuses other hosts, schemes and paths', () => {
    expect(inScope('https://auth0.com/blog/x', scope, [])).toBe(false);
    expect(inScope('https://auth0.com/docsearch', scope, [])).toBe(false);
    expect(inScope('http://auth0.com/docs/x', scope, [])).toBe(false);
    expect(inScope('https://community.auth0.com/docs/x', scope, [])).toBe(false);
  });
  it('leaves out excluded paths such as translations', () => {
    const excluded = ['/docs/fr-ca/', '/docs/ja-jp/'];
    expect(inScope('https://auth0.com/docs/fr-ca/get-started', scope, excluded)).toBe(false);
    expect(inScope('https://auth0.com/docs/fr-ca', scope, excluded)).toBe(false);
    expect(inScope('https://auth0.com/docs/get-started', scope, excluded)).toBe(true);
  });
});

describe('looksLikePage', () => {
  it('skips files that are not pages', () => {
    for (const u of ['a.png', 'b.PDF', 'c.zip', 'd.svg', 'e.css', 'f.js', 'g.mp4', 'h.json', 'i.xml'])
      expect(looksLikePage(`https://x.org/docs/${u}`), u).toBe(false);
    for (const u of ['', 'guide', 'guide/', 'index.html', 'page.htm', 'v1.2/intro', 'api.md'])
      expect(looksLikePage(`https://x.org/docs/${u}`), u).toBe(true);
  });
});
