import { apiRequests, workspaces, type Database, type NewApiRequest } from '@rag/db';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

/** What an asking route adds to its usage row. */
export type UsageDetail = Pick<
  NewApiRequest,
  | 'question'
  | 'answerId'
  | 'messageId'
  | 'model'
  | 'grounded'
  | 'promptTokens'
  | 'completionTokens'
  | 'timeToFirstTokenMs'
  | 'citedDocumentIds'
>;

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by asking routes; written to the usage log with the request. */
    usage: UsageDetail | null;
  }
}

/**
 * Writes the usage log. Rows are written after the response has gone out, so logging never
 * slows a request down or fails it; a failed write is logged and dropped.
 */
export class UsageLog {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly log?: FastifyBaseLogger,
  ) {}

  record(row: Omit<NewApiRequest, 'workspaceId'>): void {
    const p = this.write(row)
      .catch((err: unknown) => this.log?.warn({ err }, 'usage log write failed'))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Wait for writes in flight (tests, and shutdown). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  /** Clear question text older than `days`; the rows stay for counts and latency. Returns rows changed. */
  async trimQuestions(days: number): Promise<number> {
    const rows = await this.db
      .update(apiRequests)
      .set({ question: null })
      .where(
        and(
          isNotNull(apiRequests.question),
          lt(apiRequests.createdAt, sql`now() - make_interval(days => ${days})`),
        ),
      )
      .returning({ id: apiRequests.id });
    return rows.length;
  }

  private async write(row: Omit<NewApiRequest, 'workspaceId'>) {
    let workspaceId: string | null = null;
    if (row.workspaceSlug) {
      const [ws] = await this.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, row.workspaceSlug));
      workspaceId = ws?.id ?? null;
    }
    await this.db.insert(apiRequests).values({ ...row, workspaceId });
  }
}

/**
 * Logs every `/v1` request when its response ends, including streams (which Fastify's
 * `onResponse` hook does not see, because the route takes the response over).
 */
const usagePlugin: FastifyPluginAsync<{ usage: UsageLog }> = async (app, { usage }) => {
  app.decorateRequest('usage', null);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return;
    const receivedAt = new Date();
    const started = performance.now();
    let done = false;
    const finish = (hungUp: boolean) => {
      if (done) return;
      done = true;
      const slug = (req.params as { slug?: unknown } | undefined)?.slug;
      usage.record({
        // When the request arrived: rows are written concurrently, so insert order is not request order.
        createdAt: receivedAt,
        requestId: req.id,
        method: req.method,
        // The route pattern, never the raw path: a path can carry ids or anything a caller typed.
        route: req.routeOptions.url ?? '(no route)',
        // 499 (client closed request) when the caller left before the response finished.
        statusCode: hungUp ? 499 : reply.raw.statusCode,
        latencyMs: Math.round(performance.now() - started),
        workspaceSlug: typeof slug === 'string' ? slug : null,
        callerKind: req.principal?.kind ?? null,
        callerId: req.principal?.id ?? null,
        ...req.usage,
      });
    };
    // 'finish' means the whole response went out; 'close' without it means the caller left first.
    reply.raw.once('finish', () => finish(false));
    reply.raw.once('close', () => finish(true));
  });
};

export const usageLogging = fp(usagePlugin, { name: 'usage', dependencies: ['auth'] });
