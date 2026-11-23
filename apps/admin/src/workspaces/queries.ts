import type { CreateWorkspace, ReindexWorkspace, UpdateWorkspace, Workspace } from '@rag/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';

/** Retry network and server errors twice; a 4xx (no access, not found) won't change, so show it at once. */
export function shouldRetry(failures: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status < 500) return false;
  return failures < 2;
}

/**
 * Whether loading a workspace failed because there is nothing to show: 404 for a slug that doesn't exist
 * or that the caller can't see, 400 for one that can't exist (the API checks the slug's format first).
 */
export function isMissingWorkspace(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 400);
}

export function useWorkspaces() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: async () => (await api<{ data: Workspace[] }>('/v1/workspaces')).data,
  });
}

export function useWorkspace(slug: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['workspaces', slug],
    queryFn: () => api<Workspace>(`/v1/workspaces/${encodeURIComponent(slug)}`),
    // A reindex has no "finished" event of its own: the workspace goes back to `active` when its
    // last document is done, so while it runs the page asks again until it does.
    refetchInterval: (query) => (query.state.data?.status === 'reindexing' ? 5_000 : false),
  });
}

/** `PATCH /v1/workspaces/{slug}`: the name, the description and the settings PATCH accepts. */
export function useUpdateWorkspace(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWorkspace) =>
      api<Workspace>(`/v1/workspaces/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    // The name shows in the switcher and the breadcrumb, so the list is refreshed too.
    onSuccess: (workspace) => {
      queryClient.setQueryData(['workspaces', slug], workspace);
      return queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

/**
 * `POST /v1/workspaces/{slug}/reindex`: ingest every document again, optionally with another
 * embedding model (the only way to change it). Answers 202 with the workspace now `reindexing`.
 */
export function useReindexWorkspace(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReindexWorkspace) =>
      api<Workspace>(`/v1/workspaces/${encodeURIComponent(slug)}/reindex`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (workspace) => {
      queryClient.setQueryData(['workspaces', slug], workspace);
      // Every document went back to `queued`, so the Documents list is stale as well.
      return queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useCreateWorkspace() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkspace) =>
      api<Workspace>('/v1/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    // Refreshes the list and any cached workspace, so the switcher shows the new one.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
  });
}
