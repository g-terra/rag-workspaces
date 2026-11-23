import type { SystemStatus } from '@rag/shared';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';

/**
 * `GET /v1/system`: the services and the model providers, for the pickers on the settings page.
 * Admins only: `enabled` is how a screen that anyone can reach keeps a non-admin from asking and
 * being refused. A failure is never fatal — the settings page falls back to what the API's own
 * schemas accept, and the banner simply says nothing.
 */
export function useSystem(enabled = true) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['system'],
    queryFn: () => api<SystemStatus>('/v1/system'),
    enabled,
    // It asks four providers for their models, so it is not a cheap call; a minute-old answer is
    // fine for a picker or a banner, and remounting a page does not ask again.
    staleTime: 60_000,
    // Something that went down (or came back) while a page sat open should reach the banner without
    // a reload. A minute is slow enough that the providers are not polled hard.
    refetchInterval: 60_000,
  });
}
