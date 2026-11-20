import { z } from 'zod';

/**
 * Workspace slug: 3 to 40 characters, lowercase letters, digits and hyphens,
 * starting with a letter and not ending with a hyphen. It names the Chroma
 * collection (`ws_<slug>`) and the upload folder, so it never changes.
 */
export const WorkspaceSlug = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, 'lowercase letters, digits and hyphens; start with a letter');
export type WorkspaceSlug = z.infer<typeof WorkspaceSlug>;

/** RFC 9457 problem details, the body of every error response. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;

/** `GET /health`: the process is up. */
export const Health = z.object({ status: z.literal('ok') });
export type Health = z.infer<typeof Health>;

/** `GET /ready`: every dependency answers. No detail here; admins get it from `/v1/system`. */
export const Ready = z.object({ status: z.enum(['ok', 'unavailable']) });
export type Ready = z.infer<typeof Ready>;

/** List responses: `{ data, nextCursor }`. */
export const page = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });
