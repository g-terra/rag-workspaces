import { describe, expect, it } from 'vitest';
import { formatScore, parseMode, searchPath, SEARCH_LIMITS } from './search';

describe('searchPath', () => {
  it('encodes the query and the workspace into the passage search path', () => {
    expect(searchPath('ouc', 'what is rag?', 5)).toBe('/v1/workspaces/ouc/passages?query=what+is+rag%3F&limit=5'); // prettier-ignore
  });

  it('encodes a slug and a query with characters a URL would read', () => {
    expect(searchPath('a&b', 'x=1 & y', 10)).toBe('/v1/workspaces/a%26b/passages?query=x%3D1+%26+y&limit=10');
  });

  it('offers limits the API accepts', () => {
    expect(SEARCH_LIMITS.every((n) => n >= 1 && n <= 50)).toBe(true);
  });
});

describe('formatScore', () => {
  it('shows two decimals', () => {
    expect(formatScore(0.8349)).toBe('0.83');
    expect(formatScore(1)).toBe('1.00');
    expect(formatScore(0)).toBe('0.00');
  });
});

describe('parseMode', () => {
  it('reads the mode from the URL, and falls back to asking', () => {
    expect(parseMode('search')).toBe('search');
    expect(parseMode('chat')).toBe('chat');
    expect(parseMode('ask')).toBe('ask');
    expect(parseMode(null)).toBe('ask');
    expect(parseMode('nonsense')).toBe('ask');
  });
});
