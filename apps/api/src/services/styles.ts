import type { Workspace } from '@rag/db';
import type { ResponseStyle } from '@rag/shared';
import { HttpProblem } from '../errors.js';

/**
 * The styles every install has. Each changes tone, length or format only; `composeSystemPrompt`
 * reminds the model that the grounding rules still hold.
 */
export const BUILT_IN_STYLES: readonly ResponseStyle[] = [
  {
    slug: 'academic',
    name: 'Academic',
    description: 'Formal and precise, like a well-written study text.',
    instructions:
      'Write in a formal academic register. Use precise terminology and define each key term the first time it appears. ' +
      'Organise the answer in well-structured paragraphs, and point out where the material limits or qualifies a claim. ' +
      'No casual language and no emoji.',
    builtIn: true,
  },
  {
    slug: 'talkative',
    name: 'Talkative',
    description: 'Warm and conversational, explains more and connects ideas.',
    instructions:
      'Write in a warm, conversational tone, like a friendly tutor chatting with a student. ' +
      'Explain in more depth than usual and connect the ideas the passages give. A longer answer is fine. ' +
      'You may end with one short suggestion of a related question the same passages could answer.',
    builtIn: true,
  },
  {
    slug: 'concise',
    name: 'Concise',
    description: 'The shortest complete answer.',
    instructions:
      'Give the shortest answer that is still complete: one or two sentences, or a short bullet list when the answer is a list. ' +
      'No introduction and no summary at the end.',
    builtIn: true,
  },
  {
    slug: 'tutor',
    name: 'Tutor',
    description: 'Explains step by step for a beginner.',
    instructions:
      'Explain as you would to a beginner. Use plain words and short sentences, go step by step, ' +
      'and explain any technical term in simple words. Use an example only if the passages give one.',
    builtIn: true,
  },
];

/** The style with this slug. Unknown → `400`, so a typo shows instead of silently changing the answer. */
export function findStyle(slug: string): ResponseStyle {
  const style = BUILT_IN_STYLES.find((s) => s.slug === slug);
  if (!style) throw new HttpProblem(400, `No response style "${slug}". GET /v1/styles lists them.`);
  return style;
}

/** The style for one request: the one it names, else the workspace's default, else none. */
export function styleFor(requested: string | undefined, workspace: Workspace): ResponseStyle | null {
  const slug = requested ?? workspace.settings.style;
  return slug ? findStyle(slug) : null;
}

/**
 * The system prompt with a style added after it. With no style the prompt is unchanged. The header
 * repeats the grounding rules on purpose: small local models weigh the end of a prompt most, and a
 * style like `talkative` pulls towards freer answers.
 */
export function composeSystemPrompt(base: string, style: ResponseStyle | null): string {
  if (!style) return base;
  return [
    base,
    '',
    `Response style: ${style.name}. This changes only tone, length and format. Every rule above still applies: ` +
      'use only the passages, cite them with [n], give complete lists, and if the passages do not cover the question say only that.',
    style.instructions,
  ].join('\n');
}
