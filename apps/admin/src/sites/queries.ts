import type { CreateSite, Site } from '@rag/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';
import { isCrawling } from './sites';

const sitesKey = (slug: string) => ['workspaces', slug, 'sites'];
const sitesPath = (slug: string, id?: string) =>
  `/v1/workspaces/${encodeURIComponent(slug)}/sites${id ? `/${encodeURIComponent(id)}` : ''}`;
const json = { 'content-type': 'application/json' };
/** How often the list refreshes while a crawl is queued or running, for its counters. */
const POLL_MS = 2000;

/** The workspace's imported websites, polled while any of them is crawling. */
export function useSites(slug: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: sitesKey(slug),
    queryFn: async () => (await api<{ data: Site[] }>(sitesPath(slug))).data,
    refetchInterval: (q) => (q.state.data?.some(isCrawling) ? POLL_MS : false),
  });
}

export function useAddSite(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSite) =>
      api<Site>(sitesPath(slug), { method: 'POST', headers: json, body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sitesKey(slug) }),
  });
}

export function useCrawlSite(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Site>(`${sitesPath(slug, id)}/crawl`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sitesKey(slug) }),
  });
}

/** Removes a site with its pages; the documents list hears about each page from the status stream. */
export function useRemoveSite(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(sitesPath(slug, id), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sitesKey(slug) }),
  });
}
