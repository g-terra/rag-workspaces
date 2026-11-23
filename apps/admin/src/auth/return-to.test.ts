import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('keeps a path on this site, with its query', () => {
    expect(safeReturnTo('/workspaces/ouc?tab=docs')).toBe('/workspaces/ouc?tab=docs');
  });

  it.each([
    '//evil.example',
    'https://evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'workspaces',
    '',
    null,
    undefined,
  ])('falls back to / for %j', (value) => {
    expect(safeReturnTo(value)).toBe('/');
  });
});
