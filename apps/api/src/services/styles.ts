import { responseStyles, type Database, type ResponseStyleRow, type Workspace } from '@rag/db';
import type { ResponseStyle } from '@rag/shared';
import { asc, eq } from 'drizzle-orm';
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
      'Cite a passage only where it directly supports the sentence; a passage on another topic is never a source. ' +
      'If the passages do not cover the question, say so in one formal sentence and cite nothing. ' +
      'No casual language and no emoji.',
    builtIn: true,
  },
  {
    slug: 'talkative',
    name: 'Talkative',
    description: 'Warm and conversational, explains more and connects ideas.',
    instructions:
      'Write in a warm, conversational tone, like a friendly tutor chatting with a student. ' +
      'Explain in more depth than usual, but only from the passages: connect the ideas they give, and add nothing from general knowledge. ' +
      'A longer answer is fine. If the passages do not cover the question, say so in one friendly sentence and stop: no explanation, no citations. ' +
      'Only after an answer the passages support, you may end with one short suggestion of a related question the same passages could answer.',
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

export const isBuiltIn = (slug: string) => BUILT_IN_STYLES.some((s) => s.slug === slug);

export function toApiStyle(row: ResponseStyleRow): ResponseStyle {
  const { slug, name, description, instructions } = row;
  return { slug, name, description, instructions, builtIn: false };
}

/** Every style: the built-ins first, then custom ones by name. */
export async function listStyles(db: Database): Promise<ResponseStyle[]> {
  const custom = await db.select().from(responseStyles).orderBy(asc(responseStyles.name));
  return [...BUILT_IN_STYLES, ...custom.map(toApiStyle)];
}

/** The style with this slug. Unknown → `400`, so a typo shows instead of silently changing the answer. */
export async function findStyle(db: Database, slug: string): Promise<ResponseStyle> {
  const builtIn = BUILT_IN_STYLES.find((s) => s.slug === slug);
  if (builtIn) return builtIn;
  const [row] = await db.select().from(responseStyles).where(eq(responseStyles.slug, slug));
  if (!row) throw new HttpProblem(400, `No response style "${slug}". GET /v1/styles lists them.`);
  return toApiStyle(row);
}

/**
 * The style for one request: the one it names (`null`: none), else the workspace's default, else none.
 * A default that no longer resolves is ignored rather than turned into a `400` the caller did not cause.
 */
export async function styleFor(
  db: Database,
  requested: string | null | undefined,
  workspace: Workspace,
): Promise<ResponseStyle | null> {
  if (requested !== undefined) return requested === null ? null : findStyle(db, requested);
  const fallback = workspace.settings.style;
  if (!fallback) return null;
  return findStyle(db, fallback).catch((err: unknown) => {
    if (err instanceof HttpProblem) return null;
    throw err;
  });
}

/**
 * The system prompt with a style added after it. With no style the prompt is unchanged. After the
 * built-in prompt the header repeats its grounding rules on purpose: small local models weigh the end of
 * a prompt most, and a style like `talkative` pulls towards freer answers. A workspace's own prompt may
 * have other rules, so it only gets the general reminder.
 */
export function composeSystemPrompt(
  base: string,
  style: ResponseStyle | null,
  baseIsDefault: boolean,
): string {
  if (!style) return base;
  const recap = baseIsDefault
    ? ' Every rule above still applies: use only the passages, cite them with [n], give complete lists, and if the passages do not cover the question say only that, and cite nothing.'
    : ' Every rule above still applies.';
  return [
    base,
    '',
    `Response style: ${style.name}. This changes only tone, length and format.${recap}`,
    style.instructions,
  ].join('\n');
}
