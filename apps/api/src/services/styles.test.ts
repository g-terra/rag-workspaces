import { StyleSlug } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT } from './generate.js';
import { BUILT_IN_STYLES, composeSystemPrompt } from './styles.js';

const builtIn = (slug: string) => BUILT_IN_STYLES.find((s) => s.slug === slug)!;

describe('composeSystemPrompt', () => {
  it('leaves the prompt exactly as it was with no style', () => {
    expect(composeSystemPrompt(DEFAULT_SYSTEM_PROMPT, null)).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("adds the style after the base prompt, so a workspace's own prompt keeps its rules too", () => {
    const style = builtIn('academic');
    const prompt = composeSystemPrompt('Custom rules.', style);
    expect(prompt.startsWith('Custom rules.\n\nResponse style: Academic.')).toBe(true);
    expect(prompt.endsWith(style.instructions)).toBe(true);
  });

  it('repeats the grounding rules in the style header', () => {
    const prompt = composeSystemPrompt(DEFAULT_SYSTEM_PROMPT, builtIn('talkative'));
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
