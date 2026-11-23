import { HostedProvider, type ProviderStatus, type SystemStatus, type WorkspaceProvider } from '@rag/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/auth-context';

/** The providers that take an API key, in the order the page lists them. */
export const HOSTED = HostedProvider.options;

/** What the key row says about a provider: where its key comes from, and why it fails if it does. */
export function keyNote(p: WorkspaceProvider): string {
  const where =
    p.key.source === 'workspace'
      ? `Saved for this workspace, ending in ${p.key.last4}.`
      : p.key.source === 'env'
        ? 'Using the key in the API’s .env. Save one here to use another for this workspace.'
        : 'No key yet.';
  return p.error && p.key.source ? `${where} ${p.error.replace(/\.?$/, '.')}` : where;
}

/**
 * The system status with its providers replaced by the workspace's own view of them (asked with the
 * workspace's saved keys), so the pickers built on `SystemStatus` offer what this workspace can use.
 * The defaults stay the system's. Until the workspace list arrives, the system status as it is.
 */
export function withWorkspaceProviders(
  system: SystemStatus | undefined,
  providers: ProviderStatus[] | undefined,
): SystemStatus | undefined {
  if (!system || !providers) return system;
  return { ...system, providers };
}

/** A failed save or removal, in words: the API already says what the provider answered. */
export function providerKeyErrorMessage(err: unknown): string {
  if (err instanceof ApiError && [400, 403, 404, 422, 503].includes(err.status)) return err.message;
  return `Couldn't save the key: ${err instanceof Error ? err.message : String(err)}`;
}

const providersKey = (slug: string) => ['workspaces', slug, 'providers'];
const base = (slug: string) => `/v1/workspaces/${encodeURIComponent(slug)}/providers`;

/** `GET /v1/workspaces/{slug}/providers` (admins only, so the settings page is the only caller). */
export function useWorkspaceProviders(slug: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: providersKey(slug),
    queryFn: () => api<WorkspaceProvider[]>(base(slug)),
    // Each call asks every provider for its models.
    staleTime: 60_000,
  });
}

/** Saves a key (the API checks it with the provider first) and refreshes the list it changes. */
export function useSaveProviderKey(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: HostedProvider; apiKey: string }) =>
      api<WorkspaceProvider>(`${base(slug)}/${provider}/key`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providersKey(slug) }),
  });
}

export function useRemoveProviderKey(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: HostedProvider) =>
      api<void>(`${base(slug)}/${provider}/key`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: providersKey(slug) }),
  });
}
