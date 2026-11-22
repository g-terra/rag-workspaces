import { WorkspaceSlug } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { suggestSlug } from './slug';

describe('suggestSlug', () => {
  it('lowercases and joins words with single hyphens', () => {
    expect(suggestSlug('Thesis  Research & Notes')).toBe('thesis-research-notes');
  });

  it('drops accents and trims hyphens at both ends', () => {
    expect(suggestSlug('  Ação Química! ')).toBe('acao-quimica');
  });

  it('starts with a letter, as the API requires', () => {
    expect(suggestSlug('2026 notes')).toBe('notes');
    expect(suggestSlug('123')).toBe('');
  });

  it('keeps at most 40 characters without ending on a hyphen', () => {
    const slug = suggestSlug(`${'a'.repeat(39)} b`);
    expect(slug).toBe('a'.repeat(39));
    expect(WorkspaceSlug.safeParse(slug).success).toBe(true);
  });

  it('spells out letters that have no accent to drop', () => {
    expect(suggestSlug('Straße Köln')).toBe('strasse-koln');
    expect(suggestSlug('Œuvre Ærø')).toBe('oeuvre-aero');
  });

  it('suggests nothing rather than a slug the API would refuse', () => {
    expect(suggestSlug('AI')).toBe('');
    expect(suggestSlug('Учёба')).toBe('');
  });
});
