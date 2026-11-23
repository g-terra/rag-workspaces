import type { SystemStatus } from '@rag/shared';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';

/**
 * `GET /v1/system`: the services and the model providers, for the pickers on the settings page and
 * the System page. `live` asks again every 30 seconds; `enabled` holds it back for non-admins.
 * Admins only, so it is called from screens an admin alone reaches; a failure is never fatal — the
 * page that reads it falls back to what the API's own schemas accept.
 */
export function useSystem({ live = false, enabled = true }: { live?: boolean; enabled?: boolean } = {}) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['system'],
    queryFn: () => api<SystemStatus>('/v1/system'),
    enabled,
    // It asks four providers for their models, so it is not a cheap call; a minute-old list is fine
    // for a picker, and remounting the page does not ask again.
    staleTime: live ? 0 : 60_000,
    // The System page (`live`) asks again every 30 seconds while it is open.
    refetchInterval: live ? 30_000 : false,
  });
}
