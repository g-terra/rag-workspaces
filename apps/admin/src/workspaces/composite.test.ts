import type { Workspace } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { sourceChoices, sourceLabel, validateComposite } from './composite';

const ws = (slug: string, kind: 'standard' | 'composite' = 'standard', name = slug.toUpperCase()) =>
  ({ slug, name, kind, sources: kind === 'composite' ? ['a', 'b'] : null }) as Workspace;

describe('sourceChoices', () => {
  it('offers only standard workspaces, by name', () => {
    const list = [ws('zeta', 'standard', 'Zeta'), ws('mix', 'composite'), ws('alpha', 'standard', 'Alpha')];
    expect(sourceChoices(list).map((w) => w.slug)).toEqual(['alpha', 'zeta']);
  });
});

describe('validateComposite', () => {
  const form = { name: 'Study', slug: 'study', description: '', sources: ['ouc', 'personal'] };

  it('builds the API body for a composite', () => {
    expect(validateComposite(form)).toEqual({
      ok: true,
      body: {
        name: 'Study',
        slug: 'study',
        description: null,
        kind: 'composite',
        sources: ['ouc', 'personal'],
      },
    });
  });

  it('needs at least two sources, and at most ten', () => {
    expect(validateComposite({ ...form, sources: ['ouc'] })).toEqual({
      ok: false,
      errors: { sources: 'Pick at least two workspaces.' },
    });
    const many = Array.from({ length: 11 }, (_, i) => `ws-${i}x`);
    expect(validateComposite({ ...form, sources: many })).toEqual({
      ok: false,
      errors: { sources: 'Pick at most ten workspaces.' },
    });
  });

  it('reports a missing name and slug in words', () => {
    const r = validateComposite({ ...form, name: ' ', slug: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toMatchObject({ name: 'Enter a name.', slug: 'Enter a slug.' });
  });
});

describe('sourceLabel', () => {
  const all = [ws('ouc', 'standard', 'OUC study'), ws('study', 'composite')];

  it('names the source workspace of a passage found through a composite', () => {
    expect(sourceLabel('ouc', 'study', all)).toBe('OUC study');
  });

  it('says nothing when the passage is from the workspace being asked', () => {
    expect(sourceLabel('ouc', 'ouc', all)).toBeNull();
  });

  it('falls back to the slug of a source the caller cannot open', () => {
    expect(sourceLabel('hidden', 'study', all)).toBe('hidden');
  });
});
