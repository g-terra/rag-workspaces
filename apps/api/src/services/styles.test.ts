import { StyleSlug } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { HttpProblem } from '../errors.js';
import { DEFAULT_SYSTEM_PROMPT } from './generate.js';
import { BUILT_IN_STYLES, composeSystemPrompt, findStyle } from './styles.js';

describe('composeSystemPrompt', () => {
  it('leaves the prompt exactly as it was with no style', () => {
    expect(composeSystemPrompt(DEFAULT_SYSTEM_PROMPT, null)).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("adds the style after the base prompt, so a workspace's own prompt keeps its rules too", () => {
    const style = findStyle('academic');
    const prompt = composeSystemPrompt('Custom rules.', style);
    expect(prompt.startsWith('Custom rules.\n\nResponse style: Academic.')).toBe(true);
    expect(prompt.endsWith(style.instructions)).toBe(true);
  });

  it('repeats the grounding rules in the style header', () => {
    const prompt = composeSystemPrompt(DEFAULT_SYSTEM_PROMPT, findStyle('talkative'));
    const header = prompt.slice(DEFAULT_SYSTEM_PROMPT.length);
    expect(header).toContain('Every rule above still applies');
    expect(header).toContain('cite them with [n]');
    expect(header).toContain('say only that');
  });
});

describe('built-in styles', () => {
  it('are academic, talkative, concise and tutor, each with a valid unique slug', () => {
    const slugs = BUILT_IN_STYLES.map((s) => s.slug);
    expect(slugs).toEqual(['academic', 'talkative', 'concise', 'tutor']);
    for (const s of BUILT_IN_STYLES) {
      expect(StyleSlug.safeParse(s.slug).success).toBe(true);
      expect(s.builtIn).toBe(true);
      expect(s.instructions.length).toBeGreaterThan(20);
    }
  });
});

describe('findStyle', () => {
  it('finds a built-in by slug', () => {
    expect(findStyle('concise').name).toBe('Concise');
  });

  it('refuses an unknown slug with 400', () => {
    expect(() => findStyle('pirate')).toThrow(HttpProblem);
    try {
      findStyle('pirate');
    } catch (err) {
      expect((err as HttpProblem).status).toBe(400);
      expect((err as HttpProblem).message).toContain('pirate');
    }
  });
});
