import type { RequestLogEntry, UsageSummary } from '@rag/shared';
import { useState, type ReactNode } from 'react';
import { useMatch } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { ErrorState, Loading, Notice } from '@/components/states';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LatencyChart, RequestsChart, RouteBars } from '@/components/usage-charts';
import { cn } from '@/lib/utils';
import { fillBuckets, routePaths, topGroups, totalsByGroup } from '@/usage/chart';
import { useRequestLog, useUsage, usageBase, type LogFilters } from '@/usage/queries';
import {
  formatCount,
  formatDuration,
  formatPercent,
  formatTokens,
  RANGES,
  statusTone,
  type RangeKey,
} from '@/usage/range';
import { useCurrentWorkspace } from '@/workspaces/current';

/** `/usage` (every workspace, admins) and `/w/:slug/usage` (one workspace, its editors and admins). */
export function Usage() {
  const workspaceRoute = !!useMatch('/w/:slug/*');
  return workspaceRoute ? <WorkspaceUsage /> : <GlobalUsage />;
}

function GlobalUsage() {
  const { me } = useAuth();
  if (!me) return <Loading what="your account" />;
  if (!me.isAdmin) {
    return (
      <>
        <TopBar trail={['Usage']} />
        <div className="px-6 py-7">
          <Notice
            title="Admins only"
            body="This page covers every workspace. Open a workspace and use its own Usage page instead."
            alert
          />
        </div>
      </>
    );
  }
  return (
    <UsagePage
      trail={['Admin', 'Usage']}
      lead="Every API request is logged with its workspace, key or user, latency and tokens."
    />
  );
}

function WorkspaceUsage() {
  const w = useCurrentWorkspace();
  if (w.access === 'reader') {
    return (
      <>
        <TopBar trail={[w.name, 'Usage']} />
        <div className="px-6 py-7">
          <Notice
            title="Editors and admins only"
            body="Usage analytics cover everyone's questions in this workspace, so they need the editor role."
            alert
          />
        </div>
      </>
    );
  }
  return (
    <UsagePage
      key={w.slug}
      slug={w.slug}
      trail={[w.name, 'Usage']}
      lead={`Every request to this workspace, with its caller, latency and tokens.`}
    />
  );
}

function UsagePage({ slug, trail, lead }: { slug?: string; trail: string[]; lead: string }) {
  // `now` is held with the range, so every card asks about exactly the same slice and a re-render
  // doesn't move the window under them. Picking a range anchors a new "now".
  const [{ range, now }, setSlice] = useState({ range: '7d' as RangeKey, now: new Date() });
  const base = usageBase(slug);
  const { summary, timeseries, byRoute, questions, documents, interval, from, to } = useUsage(
    base,
    range,
    now,
  );
  // The API sends only the buckets that saw traffic; the charts want one column per bucket in the range.
  const points = timeseries.data ? fillBuckets(timeseries.data.data, from, to, interval) : [];

  return (
    <>
      <TopBar trail={trail} />
      <div className="flex w-full max-w-290 flex-col gap-5 px-6 pt-7 pb-12">
        <div>
          <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">Usage analytics</h1>
          <p className="text-muted-foreground text-sm">{lead}</p>
        </div>

        {/* One row of filters above everything they scope. */}
        <div role="group" aria-label="Time range" className="bg-muted flex w-fit rounded-lg p-0.5">
          {RANGES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={range === key}
              onClick={() => setSlice({ range: key, now: new Date() })}
              className={cn(
                'h-8 rounded-md px-3 text-sm',
                range === key ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {summary.isPending && <Loading what="usage" />}
        {summary.isError && (
          <ErrorState
            title="Couldn't load usage"
            error={summary.error}
            onRetry={() => void summary.refetch()}
          />
        )}
        {summary.data && <Tiles summary={summary.data} />}

        {timeseries.isError && (
          <ErrorState
            title="Couldn't load the charts"
            error={timeseries.error}
            onRetry={() => void timeseries.refetch()}
          />
        )}
        {timeseries.data && points.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <RequestsChart points={points} interval={interval} stale={timeseries.isFetching} />
            <LatencyChart points={points} interval={interval} stale={timeseries.isFetching} />
          </div>
        )}
        {timeseries.data && points.length === 0 && (
          <Notice title="Nothing in this range" body="No request reached the API in the range you picked." />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Requests by route" note="over the whole range">
            {byRoute.data && <RouteBars totals={topGroups(totalsByGroup(byRoute.data.data), 7)} />}
            {byRoute.data?.data.length === 0 && <Empty what="requests" />}
          </Card>
          <Card title="Top questions" note="grouped ignoring case">
            {questions.data?.data.map((q, i) => (
              <div key={q.question} className="flex items-start gap-3 text-sm">
                <span className="text-muted-foreground w-4 text-xs">{i + 1}</span>
                <span className="flex-1">{q.question}</span>
                <span className="text-[13px] font-medium">{formatCount(q.count)}</span>
              </div>
            ))}
            {questions.data?.data.length === 0 && <Empty what="questions" />}
          </Card>
        </div>

        <Card title="Most cited documents" note="how often a document was given to the model">
          {documents.data?.data.map((d, i) => (
            <div key={d.documentId} className="flex items-start gap-3 text-sm">
              <span className="text-muted-foreground w-4 text-xs">{i + 1}</span>
              <span className="flex-1">
                {d.title ?? <span className="text-muted-foreground">deleted since</span>}
                <span className="text-muted-foreground block font-mono text-xs">{d.documentId}</span>
              </span>
              <span className="text-[13px] font-medium">{formatCount(d.citations)}</span>
            </div>
          ))}
          {documents.data?.data.length === 0 && <Empty what="citations" />}
        </Card>

        <RequestLog base={base} range={range} now={now} routes={routePaths(byRoute.data?.data ?? [])} />
      </div>
    </>
  );
}

function Tiles({ summary }: { summary: UsageSummary }) {
  const tiles: [string, string, string][] = [
    ['Requests', formatCount(summary.requests), `${formatCount(summary.clientErrors)} refused by the API`],
    [
      'Error rate',
      formatPercent(summary.errorRate),
      `${formatCount(summary.serverErrors)} server error${summary.serverErrors === 1 ? '' : 's'}`,
    ],
    [
      'Latency p50 / p95',
      `${formatDuration(summary.latencyMs.p50)} / ${formatDuration(summary.latencyMs.p95)}`,
      'every route',
    ],
    [
      'Tokens',
      formatTokens(summary.tokens.prompt + summary.tokens.completion),
      `${formatTokens(summary.tokens.prompt)} prompt · ${formatTokens(summary.tokens.completion)} completion`,
    ],
    [
      'Questions',
      formatCount(summary.questions),
      `${formatCount(summary.ungrounded)} found nothing · ${formatCount(summary.feedback.up)} up / ${formatCount(summary.feedback.down)} down`,
    ],
  ];
  return (
    <div className="bg-card grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] rounded-xl border">
      {tiles.map(([label, value, note], i) => (
        <div key={label} className={cn('px-4.5 py-4', i < tiles.length - 1 && 'border-r')}>
          <p className="text-muted-foreground mb-1.5 text-[13px]">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          <p className="text-muted-foreground mt-1 text-xs">{note}</p>
        </div>
      ))}
    </div>
  );
}

const LOG_COLUMNS = ['Time', 'Route', 'Status', 'Workspace', 'Caller', 'Latency', 'Tokens', 'Request id'];

function RequestLog({
  base,
  range,
  now,
  routes,
}: {
  base: string;
  range: RangeKey;
  now: Date;
  /** The route patterns seen in the range; the API matches a whole pattern, not a substring. */
  routes: string[];
}) {
  const [filters, setFilters] = useState<LogFilters>({ route: '', status: '' });
  // One cursor per page already visited, so "Newer" can go back without asking the API for it.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const log = useRequestLog(base, range, now, filters, cursor);

  const change = (next: Partial<LogFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setCursors([null]);
  };

  return (
    <div className="bg-card rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">Request log</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Route"
            className="border-input dark:bg-input/30 h-8 max-w-72 rounded-md border bg-transparent px-2 text-[13px] shadow-xs"
            value={filters.route}
            onChange={(e) => change({ route: e.target.value })}
          >
            <option value="">All routes</option>
            {routes.map((route) => (
              <option key={route} value={route}>
                {route}
              </option>
            ))}
          </select>
          <Input
            className="h-8 w-28"
            inputMode="numeric"
            placeholder="Status"
            aria-label="Status"
            value={filters.status}
            onChange={(e) => change({ status: e.target.value.replace(/\D/g, '').slice(0, 3) })}
          />
        </div>
      </div>
      {log.isPending && <Loading what="requests" />}
      {log.isError && (
        <div className="px-5 pb-5">
          <ErrorState
            title="Couldn't load the request log"
            error={log.error}
            onRetry={() => void log.refetch()}
          />
        </div>
      )}
      {log.data && (
        <>
          <div className="overflow-x-auto border-t">
            <table aria-label="Request log" className="w-full text-[13px]">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  {LOG_COLUMNS.map((head) => (
                    <th key={head} className="px-3.5 py-2 font-medium whitespace-nowrap">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.data.data.map((entry) => (
                  <LogRow key={entry.id} entry={entry} />
                ))}
                {log.data.data.length === 0 && (
                  <tr>
                    <td
                      colSpan={LOG_COLUMNS.length}
                      className="text-muted-foreground px-3.5 py-6 text-center"
                    >
                      No request matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 px-5 py-3">
            <p className="text-muted-foreground text-xs">
              Page {cursors.length} · newest first
              {log.isFetching && ' · loading…'}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={cursors.length === 1}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                Newer
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!log.data.nextCursor}
                onClick={() => setCursors((c) => [...c, log.data.nextCursor])}
              >
                Older
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const TONES = {
  ok: 'bg-green-100 text-green-800',
  client: 'bg-amber-100 text-amber-800',
  server: 'bg-red-100 text-red-800',
};

function LogRow({ entry }: { entry: RequestLogEntry }) {
  const tokens = (entry.promptTokens ?? 0) + (entry.completionTokens ?? 0);
  return (
    <tr data-testid="request-row" className="border-b last:border-b-0">
      <td className="text-muted-foreground px-3.5 py-2 whitespace-nowrap">
        {new Date(entry.createdAt).toLocaleTimeString('en-GB', { timeStyle: 'medium' })}
      </td>
      <td className="px-3.5 py-2 font-mono text-xs">
        {entry.method} {entry.route}
      </td>
      <td className="px-3.5 py-2">
        <span
          className={cn(
            'inline-flex h-5 items-center rounded px-1.5 font-mono text-xs font-medium',
            TONES[statusTone(entry.statusCode)],
          )}
        >
          {entry.statusCode}
        </span>
      </td>
      <td className="px-3.5 py-2 font-mono text-xs">{entry.workspace ?? '–'}</td>
      <td className="px-3.5 py-2">
        <span className="block max-w-44 truncate" title={entry.caller?.id ?? 'no caller'}>
          {entry.caller ? `${entry.caller.kind}: ${entry.caller.id}` : 'anonymous'}
        </span>
      </td>
      <td className="px-3.5 py-2 whitespace-nowrap">{formatDuration(entry.latencyMs)}</td>
      <td className="text-muted-foreground px-3.5 py-2">{tokens ? formatCount(tokens) : '–'}</td>
      <td className="text-muted-foreground px-3.5 py-2 font-mono text-xs">{entry.requestId}</td>
    </tr>
  );
}

function Card({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="bg-card rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-muted-foreground text-xs">{note}</span>
      </div>
      <div className="flex flex-col gap-2.5 px-5 py-4">{children}</div>
    </div>
  );
}

function Empty({ what }: { what: string }) {
  return <p className="text-muted-foreground text-sm">No {what} in this range yet.</p>;
}
