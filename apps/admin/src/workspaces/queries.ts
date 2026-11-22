import type { Workspace } from '@rag/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';

/** Retry network and server errors twice; a 4xx (no access, not found) won't change, so show it at once. */
export function shouldRetry(failures: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status < 500) return false;
  return failures < 2;
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
  });
}
