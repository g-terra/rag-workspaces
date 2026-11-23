import type { SystemStatus } from '@rag/shared';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';

/**
 * `GET /v1/system`: the services and the model providers, for the pickers on the settings page.
 * Admins only, so it is called from screens an admin alone reaches; a failure is never fatal — the
 * page that reads it falls back to what the API's own schemas accept.
 */
export function useSystem() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['system'],
    queryFn: () => api<SystemStatus>('/v1/system'),
    // It asks four providers for their models, so it is not a cheap call; a minute-old list is fine
    // for a picker, and remounting the page does not ask again.
    staleTime: 60_000,
  });
}
