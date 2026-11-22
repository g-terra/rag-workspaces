import { z } from 'zod';

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
