import type { User, WorkspaceMember, WorkspaceRole } from '@rag/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';

const path = (slug: string) => `/v1/workspaces/${encodeURIComponent(slug)}/members`;
const membersKey = (slug: string) => ['workspaces', slug, 'members'];

/** `GET /v1/workspaces/{slug}/members`: who has been granted a role, oldest grant first. */
export function useMembers(slug: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: membersKey(slug),
    queryFn: async () => (await api<{ data: WorkspaceMember[] }>(path(slug))).data,
  });
}

/**
 * `GET /v1/users`: the people in Keycloak's realm, for naming members and for the picker. Admins
 * only, and 503 when the people list is not set up — the page falls back to a plain id field then.
 * `search` is Keycloak's own, over username, email and name.
 */
export function useUsers(search: string) {
  const { api } = useAuth();
  const query = new URLSearchParams({ limit: '50' });
  if (search) query.set('search', search);
  return useQuery({
    queryKey: ['users', search],
    queryFn: async () => (await api<{ data: User[] }>(`/v1/users?${query}`)).data,
    // Accounts are made in Keycloak's console, so the list barely moves while a page is open.
    staleTime: 60_000,
    // Each new search is a new key; without this the picker would empty between keystrokes.
    placeholderData: keepPreviousData,
  });
}

/** `PUT /v1/workspaces/{slug}/members/{userId}`: grant access, or change the role of a grant. */
export function useGrantMember(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      api<WorkspaceMember>(`${path(slug)}/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membersKey(slug) }),
  });
}

/** `DELETE /v1/workspaces/{slug}/members/{userId}`: take a person's access away. */
export function useRemoveMember(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`${path(slug)}/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: membersKey(slug) }),
  });
}

/**
 * `DELETE /v1/workspaces/{slug}`: the workspace with its documents, files, vectors, conversations
 * and usage history. An API key bound to this workspace alone is revoked with it.
 */
export function useDeleteWorkspace(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/v1/workspaces/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      // Its own cache entries would otherwise be served to the next screen that asks.
      queryClient.removeQueries({ queryKey: ['workspaces', slug] });
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      // A revoked key changes the keys list too.
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}
