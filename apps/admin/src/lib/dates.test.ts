import { describe, expect, it } from 'vitest';
import { formatRelative } from './dates';

describe('formatRelative', () => {
  const now = new Date('2026-11-22T12:00:00Z');

  it('is relative within a day, then a short date', () => {
    expect(formatRelative('2026-11-22T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-11-22T11:58:00Z', now)).toBe('2 min ago');
    expect(formatRelative('2026-11-22T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelative('2026-11-03T09:00:00Z', now)).toBe('3 Nov');
    expect(formatRelative('2025-10-20T09:00:00Z', now)).toBe('20 Oct 2025');
  });
});
