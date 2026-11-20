import { answers, apiRequests, type Database } from '@rag/db';
import { and, desc, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';

/** Analytics cover one workspace, or everything (admins). */
export type Scope = { workspaceId?: string };
export type Range = { from: Date; to: Date };

const DAY = 24 * 60 * 60 * 1000;

/** `from`/`to` from the query string; the last 7 days by default. */
export function rangeOf(q: { from?: string; to?: string }): Range {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 7 * DAY);
  return { from, to };
}

// The routes that ask something. A row from one of them is a "question" even after
// retention has cleared its text.
const ASKING = sql`(
  (${apiRequests.method} = 'POST' and ${apiRequests.route} = '/v1/workspaces/:slug/answers') or
  (${apiRequests.method} = 'POST' and ${apiRequests.route} = '/v1/workspaces/:slug/conversations/:conversationId/messages') or
  (${apiRequests.method} = 'GET' and ${apiRequests.route} = '/v1/workspaces/:slug/passages')
)`;
// Answers and chat replies (not plain searches).
const GENERATED = sql`(${apiRequests.answerId} is not null or ${apiRequests.messageId} is not null)`;

function where(scope: Scope, range: Range, ...more: (SQL | undefined)[]) {
  return and(
    gte(apiRequests.createdAt, range.from),
    lt(apiRequests.createdAt, range.to),
    scope.workspaceId ? eq(apiRequests.workspaceId, scope.workspaceId) : undefined,
    ...more,
  );
}

const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function summary(db: Database, scope: Scope, range: Range) {
  const [row] = await db
    .select({
      requests: sql<number>`count(*)::int`,
      serverErrors: sql<number>`(count(*) filter (where ${apiRequests.statusCode} >= 500))::int`,
      clientErrors: sql<number>`(count(*) filter (where ${apiRequests.statusCode} between 400 and 499))::int`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${apiRequests.latencyMs})`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${apiRequests.latencyMs})`,
      questions: sql<number>`(count(*) filter (where ${ASKING}))::int`,
      ungrounded: sql<number>`(count(*) filter (where ${apiRequests.grounded} = false))::int`,
      promptTokens: sql<number>`coalesce(sum(${apiRequests.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${apiRequests.completionTokens}), 0)::int`,
    })
    .from(apiRequests)
    .where(where(scope, range));
  const [fb] = await db
    .select({
      up: sql<number>`(count(*) filter (where ${answers.feedbackRating} = 'up'))::int`,
      down: sql<number>`(count(*) filter (where ${answers.feedbackRating} = 'down'))::int`,
    })
    .from(answers)
    .where(
      and(
        gte(answers.feedbackAt, range.from),
        lt(answers.feedbackAt, range.to),
        scope.workspaceId ? eq(answers.workspaceId, scope.workspaceId) : undefined,
      ),
    );
  const r = row!;
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    requests: r.requests,
    serverErrors: r.serverErrors,
    clientErrors: r.clientErrors,
    errorRate: r.requests ? Number((r.serverErrors / r.requests).toFixed(4)) : 0,
    latencyMs: { p50: num(r.p50), p95: num(r.p95) },
    questions: r.questions,
    ungrounded: r.ungrounded,
    tokens: { prompt: r.promptTokens, completion: r.completionTokens },
    feedback: { up: fb?.up ?? 0, down: fb?.down ?? 0 },
  };
}

const GROUPS = {
  route: sql`${apiRequests.method} || ' ' || ${apiRequests.route}`,
  apiKey: sql`case when ${apiRequests.callerKind} = 'key' then ${apiRequests.callerId} end`,
  user: sql`case when ${apiRequests.callerKind} = 'user' then ${apiRequests.callerId} end`,
  workspace: sql`${apiRequests.workspaceSlug}`,
} as const;

export async function timeseries(
  db: Database,
  scope: Scope,
  range: Range,
  interval: 'hour' | 'day',
  groupBy?: keyof typeof GROUPS,
) {
  // `interval` is one of two literals (checked by the schema), so it is safe inline.
  const bucket = sql`date_trunc(${sql.raw(`'${interval}'`)}, ${apiRequests.createdAt})`;
  const group = groupBy ? GROUPS[groupBy] : sql`null::text`;
  const rows = await db
    .select({
      bucket: sql<string>`${bucket}`,
      group: sql<string | null>`${group}`,
      requests: sql<number>`count(*)::int`,
      serverErrors: sql<number>`(count(*) filter (where ${apiRequests.statusCode} >= 500))::int`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${apiRequests.latencyMs})`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${apiRequests.latencyMs})`,
    })
    .from(apiRequests)
    .where(where(scope, range))
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`1`, sql`2`);
  return rows.map((r) => ({
    bucket: new Date(r.bucket).toISOString(),
    group: r.group,
    requests: r.requests,
    serverErrors: r.serverErrors,
    latencyP50Ms: num(r.p50),
    latencyP95Ms: num(r.p95),
  }));
}

export async function topQuestions(db: Database, scope: Scope, range: Range, limit: number) {
  const rows = await db
    .select({
      question: sql<string>`(array_agg(${apiRequests.question} order by ${apiRequests.createdAt}))[1]`,
      count: sql<number>`count(*)::int`,
      last: sql<string>`max(${apiRequests.createdAt})`,
    })
    .from(apiRequests)
    .where(where(scope, range, isNotNull(apiRequests.question), GENERATED))
    .groupBy(sql`lower(btrim(${apiRequests.question}))`)
    .orderBy(sql`2 desc`, sql`3 desc`)
    .limit(limit);
  return rows.map((r) => ({
    question: r.question,
    count: r.count,
    lastAskedAt: new Date(r.last).toISOString(),
  }));
}

export async function topDocuments(db: Database, scope: Scope, range: Range, limit: number) {
  const scoped = scope.workspaceId ? sql`and r.workspace_id = ${scope.workspaceId}` : sql``;
  const rows = await db.execute<{ document_id: string; title: string | null; citations: number }>(sql`
    select c.document_id, d.title, count(*)::int as citations
    from api_requests r
    cross join lateral unnest(r.cited_document_ids) as c(document_id)
    left join documents d on d.id = c.document_id
    where r.created_at >= ${range.from.toISOString()}::timestamptz and r.created_at < ${range.to.toISOString()}::timestamptz
      and (r.answer_id is not null or r.message_id is not null)
      ${scoped}
    group by c.document_id, d.title
    order by citations desc, c.document_id
    limit ${limit}`);
  return [...rows].map((r) => ({ documentId: r.document_id, title: r.title, citations: r.citations }));
}

export type RequestFilter = {
  route?: string;
  status?: number;
  apiKeyId?: string;
  userId?: string;
  limit: number;
  cursor?: string;
};

/** The raw log, newest first. The cursor is the last row's id. */
export async function requestLog(db: Database, scope: Scope, range: Range, f: RequestFilter) {
  const rows = await db
    .select()
    .from(apiRequests)
    .where(
      where(
        scope,
        range,
        f.route ? eq(apiRequests.route, f.route) : undefined,
        f.status ? eq(apiRequests.statusCode, f.status) : undefined,
        f.apiKeyId ? and(eq(apiRequests.callerKind, 'key'), eq(apiRequests.callerId, f.apiKeyId)) : undefined,
        f.userId ? and(eq(apiRequests.callerKind, 'user'), eq(apiRequests.callerId, f.userId)) : undefined,
        f.cursor ? lt(apiRequests.id, Number(f.cursor)) : undefined,
      ),
    )
    .orderBy(desc(apiRequests.id))
    .limit(f.limit + 1);
  const page = rows.slice(0, f.limit);
  return {
    data: page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      requestId: r.requestId,
      method: r.method,
      route: r.route,
      statusCode: r.statusCode,
      latencyMs: r.latencyMs,
      workspace: r.workspaceSlug,
      caller: r.callerKind && r.callerId ? { kind: r.callerKind, id: r.callerId } : null,
      question: r.question,
      answerId: r.answerId,
      messageId: r.messageId,
      model: r.model,
      grounded: r.grounded,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      timeToFirstTokenMs: r.timeToFirstTokenMs,
    })),
    nextCursor: rows.length > f.limit ? String(page.at(-1)!.id) : null,
  };
}
