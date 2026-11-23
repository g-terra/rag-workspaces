import { z } from 'zod';

/** Time range for analytics. Defaults: the last 7 days up to now. */
export const UsageRange = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const UsageSummary = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  requests: z.number().int(),
  /** Responses with status 500 and above. */
  serverErrors: z.number().int(),
  /** Responses with status 400 to 499 (bad input, no access, rate limited). */
  clientErrors: z.number().int(),
  /** serverErrors / requests, 0 when there were none. */
  errorRate: z.number(),
  latencyMs: z.object({ p50: z.number().nullable(), p95: z.number().nullable() }),
  /** Answers, chat messages and passage searches. */
  questions: z.number().int(),
  /** Answers and chat replies where nothing relevant was found. */
  ungrounded: z.number().int(),
  tokens: z.object({ prompt: z.number().int(), completion: z.number().int() }),
  /** Ratings given in the range. */
  feedback: z.object({ up: z.number().int(), down: z.number().int() }),
});

export const TimeseriesQuery = UsageRange.extend({
  interval: z.enum(['hour', 'day']).default('day'),
  groupBy: z.enum(['route', 'apiKey', 'user', 'workspace']).optional(),
});

export const TimeseriesPoint = z.object({
  /** Start of the interval. */
  bucket: z.iso.datetime(),
  /** The route, key id, user id or workspace slug; `null` when not grouped (or no caller). */
  group: z.string().nullable(),
  requests: z.number().int(),
  serverErrors: z.number().int(),
  latencyP50Ms: z.number().nullable(),
  latencyP95Ms: z.number().nullable(),
});
export const Timeseries = z.object({ data: z.array(TimeseriesPoint) });

export const TopQuery = UsageRange.extend({ limit: z.coerce.number().int().min(1).max(100).default(10) });

export const TopQuestions = z.object({
  data: z.array(
    z.object({
      /** As first asked; questions are matched ignoring case and surrounding spaces. */
      question: z.string(),
      count: z.number().int(),
      lastAskedAt: z.iso.datetime(),
    }),
  ),
});

export const TopDocuments = z.object({
  data: z.array(
    z.object({
      documentId: z.string(),
      /** `null` when the document has been deleted since. */
      title: z.string().nullable(),
      citations: z.number().int(),
    }),
  ),
});

export const RequestLogQuery = UsageRange.extend({
  route: z.string().optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  apiKeyId: z.string().optional(),
  userId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(/^\d+$/, 'a cursor from a previous page').optional(),
});

export const RequestLogEntry = z.object({
  id: z.number().int(),
  createdAt: z.iso.datetime(),
  requestId: z.string(),
  method: z.string(),
  route: z.string(),
  statusCode: z.number().int(),
  latencyMs: z.number().int(),
  workspace: z.string().nullable(),
  caller: z.object({ kind: z.enum(['user', 'key']), id: z.string() }).nullable(),
  question: z.string().nullable(),
  answerId: z.string().nullable(),
  messageId: z.string().nullable(),
  model: z.string().nullable(),
  grounded: z.boolean().nullable(),
  promptTokens: z.number().int().nullable(),
  completionTokens: z.number().int().nullable(),
  timeToFirstTokenMs: z.number().int().nullable(),
});
