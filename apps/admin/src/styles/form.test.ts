import type { ResponseStyle } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { emptyStyleForm, slugFor, styleFormFor, validateNewStyle, validateStyleEdit } from './form';

const socratic: ResponseStyle = {
  slug: 'socratic',
  name: 'Socratic',
  description: 'Asks back.',
  instructions: 'Ask one question back.',
  builtIn: false,
};

describe('slugFor', () => {
  it('turns a name into a slug the API accepts', () => {
    expect(slugFor('  Exam Prep: Short & Sharp! ')).toBe('exam-prep-short-sharp');
    expect(slugFor('Ünïcödé Style')).toBe('unicode-style');
    expect(slugFor('x'.repeat(60))).toHaveLength(40);
    expect(slugFor('!!!')).toBe('');
  });
});

describe('validateNewStyle', () => {
  const form = {
    ...emptyStyleForm(),
    slug: 'exam-prep',
    name: 'Exam prep',
    instructions: 'Use bullet points.',
  };

  it('builds the POST body, trimmed', () => {
    expect(validateNewStyle({ ...form, name: '  Exam prep ', description: ' For revision. ' })).toEqual({
      ok: true,
      body: {
        slug: 'exam-prep',
        name: 'Exam prep',
        description: 'For revision.',
        instructions: 'Use bullet points.',
      },
    });
  });

  it('says what is missing or wrong, per field', () => {
    expect(validateNewStyle({ ...form, slug: 'Exam Prep', name: '', instructions: ' ' })).toEqual({
      ok: false,
      errors: {
        slug: 'Use lowercase letters, digits and dashes (at most 40).',
        name: 'Enter a name.',
        instructions: 'Write the instructions.',
      },
    });
  });

  it('refuses a slug a built-in style already uses', () => {
    expect(validateNewStyle({ ...form, slug: 'academic' }, ['academic'])).toEqual({
      ok: false,
      errors: { slug: 'A style named “academic” already exists.' },
    });
  });

  it('caps instructions at 2,000 characters', () => {
    const res = validateNewStyle({ ...form, instructions: 'x'.repeat(2001) });
    expect(res).toEqual({ ok: false, errors: { instructions: 'Use at most 2,000 characters.' } });
  });
});

describe('validateStyleEdit', () => {
  it('sends only what changed', () => {
    const form = { ...styleFormFor(socratic), instructions: 'Ask two questions back.' };
    expect(validateStyleEdit(form, socratic)).toEqual({
      ok: true,
      body: { instructions: 'Ask two questions back.' },
    });
  });

  it('sends nothing when nothing changed', () => {
    expect(validateStyleEdit(styleFormFor(socratic), socratic)).toEqual({ ok: true, body: {} });
  });
});
