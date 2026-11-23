import type { RequestLogEntry, Timeseries, TopDocuments, TopQuestions, UsageSummary } from '@rag/shared';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';
import { intervalFor, rangeFor, type RangeKey } from './range';

/** `/v1/usage` for admins, `/v1/workspaces/<slug>/usage` for a workspace's editors and admins. */
export function usageBase(slug?: string): string {
  return slug ? `/v1/workspaces/${encodeURIComponent(slug)}/usage` : '/v1/usage';
}

export interface LogFilters {
  route: string;
  status: string;
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
};

/**
 * One hook per card. They share the range, so TanStack Query keeps the whole page on the same slice
 * and a range change refetches every card at once.
 */
export function useUsage(base: string, range: RangeKey, now: Date) {
  const { api } = useAuth();
  const { from, to } = rangeFor(range, now);
  const interval = intervalFor(range);
  const key = (part: string, extra: Record<string, string> = {}) => ['usage', base, part, from, to, extra];

  const summary = useQuery({
    queryKey: key('summary'),
    queryFn: () => api<UsageSummary>(`${base}/summary?${query({ from, to })}`),
  });
  const timeseries = useQuery({
    queryKey: key('timeseries', { interval }),
    queryFn: () => api<Timeseries>(`${base}/timeseries?${query({ from, to, interval })}`),
  });
  const byRoute = useQuery({
    queryKey: key('timeseries', { interval, groupBy: 'route' }),
    queryFn: () => api<Timeseries>(`${base}/timeseries?${query({ from, to, interval, groupBy: 'route' })}`),
  });
  const questions = useQuery({
    queryKey: key('top-questions'),
    queryFn: () => api<TopQuestions>(`${base}/top-questions?${query({ from, to, limit: 5 })}`),
  });
  const documents = useQuery({
    queryKey: key('top-documents'),
    queryFn: () => api<TopDocuments>(`${base}/top-documents?${query({ from, to, limit: 5 })}`),
  });

  return { summary, timeseries, byRoute, questions, documents, interval, from, to };
}

/** The request log, newest first. `cursor` comes from the previous page's `nextCursor`. */
export function useRequestLog(
  base: string,
  range: RangeKey,
  now: Date,
  filters: LogFilters,
  cursor: string | null,
) {
  const { api } = useAuth();
  const { from, to } = rangeFor(range, now);
  return useQuery({
    queryKey: ['usage', base, 'requests', from, to, filters, cursor],
    queryFn: () =>
      api<{ data: RequestLogEntry[]; nextCursor: string | null }>(
        `${base}/requests?${query({
          from,
          to,
          route: filters.route,
          status: filters.status,
          limit: 25,
          cursor: cursor ?? undefined,
        })}`,
      ),
  });
}
