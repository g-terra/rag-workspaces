import type { ApiKey, CreateApiKey, CreatedApiKey, UpdateApiKey } from '@rag/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';

const keysKey = ['api-keys'];
const path = (id?: string) => (id ? `/v1/api-keys/${encodeURIComponent(id)}` : '/v1/api-keys');
const json = { 'content-type': 'application/json' };

/** Every API key, newest first. Admin-only: the API answers 403 for anyone else. */
export function useApiKeys() {
  const { api } = useAuth();
  return useQuery({
    queryKey: keysKey,
    queryFn: async () => (await api<{ data: ApiKey[] }>(path())).data,
  });
}

/** Creates a key. Its answer is the only time the secret exists outside the caller's hands. */
export function useCreateApiKey() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateApiKey) =>
      api<CreatedApiKey>(path(), { method: 'POST', headers: json, body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keysKey }),
  });
}

export function useUpdateApiKey(id: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateApiKey) =>
      api<ApiKey>(path(id), { method: 'PATCH', headers: json, body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keysKey }),
  });
}

export function useRevokeApiKey(id: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(path(id), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keysKey }),
  });
}
