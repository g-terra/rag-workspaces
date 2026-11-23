import { StyleSlug } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SYSTEM_PROMPT } from './generate.js';
import { BUILT_IN_STYLES, composeSystemPrompt } from './styles.js';

const builtIn = (slug: string) => BUILT_IN_STYLES.find((s) => s.slug === slug)!;

describe('composeSystemPrompt', () => {
  it('leaves the prompt exactly as it was with no style', () => {
    expect(composeSystemPrompt(DEFAULT_SYSTEM_PROMPT, null, true)).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("adds the style after the base prompt, so a workspace's own prompt keeps its rules too", () => {
    const style = builtIn('academic');
    const prompt = composeSystemPrompt('Custom rules.', style, false);
    expect(prompt.startsWith('Custom rules.\n\nResponse style: Academic.')).toBe(true);
    expect(prompt.endsWith(style.instructions)).toBe(true);
  });

  it("does not impose the default rules on a workspace's own prompt", () => {
    const prompt = composeSystemPrompt('Answer freely.', builtIn('talkative'), false);
    expect(prompt).toContain('Every rule above still applies.');
    expect(prompt).not.toContain('cite them with [n]');
  });

  it('repeats the grounding rules in the style header', () => {
    const prompt = composeSystemPrompt(DEFAULT_SYSTEM_PROMPT, builtIn('talkative'), true);
    const header = prompt.slice(DEFAULT_SYSTEM_PROMPT.length);
    expect(header).toContain('Every rule above still applies');
    expect(header).toContain('cite them with [n]');
    expect(header).toContain('say only that');
  });

  it('tells the model to cite nothing when the passages do not cover the question', () => {
    const prompt = composeSystemPrompt(DEFAULT_SYSTEM_PROMPT, builtIn('academic'), true);
    expect(prompt.slice(DEFAULT_SYSTEM_PROMPT.length)).toContain('say only that, and cite nothing');
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

  // On a real model, talkative explained an off-topic question from general knowledge, and academic
  // refused while citing unrelated passages (docs/tuning.md). Their own text now covers that case.
  it('keep talkative to the passages, with no related-question suggestion after a refusal', () => {
    const { instructions } = builtIn('talkative');
    expect(instructions).toContain('only from the passages');
    expect(instructions).toContain('one friendly sentence');
    expect(instructions).toContain('Only after an answer the passages support');
  });

  it('have academic cite only passages that support the sentence, and nothing in a refusal', () => {
    const { instructions } = builtIn('academic');
    expect(instructions).toContain('Cite a passage only where it directly supports the sentence');
    expect(instructions).toContain('cite nothing');
  });
});
