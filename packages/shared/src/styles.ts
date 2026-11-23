import { z } from 'zod';

/** Names a response style in requests and settings, like `academic`. */
export const StyleSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and dashes, at most 40');
export type StyleSlug = z.infer<typeof StyleSlug>;

/**
 * How an answer reads (tone, length, format), never what it may say: the instructions are added after
 * the workspace's system prompt, whose grounding rules still apply.
 */
export const ResponseStyle = z.object({
  slug: StyleSlug,
  name: z.string(),
  description: z.string(),
  /** Added to the system prompt, after a header that repeats the grounding rules. */
  instructions: z.string(),
  /** Built-in styles ship with the API and can't be changed. */
  builtIn: z.boolean(),
});
export type ResponseStyle = z.infer<typeof ResponseStyle>;

export const StyleList = z.object({ data: z.array(ResponseStyle) });
export type StyleList = z.infer<typeof StyleList>;
