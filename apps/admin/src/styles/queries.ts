import type { CreateStyle, ResponseStyle, StyleList, UpdateStyle } from '@rag/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';

/** `GET /v1/styles`: the built-in response styles, then custom ones. Any signed-in person can read it. */
export function useStyles() {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['styles'],
    queryFn: async () => (await api<StyleList>('/v1/styles')).data,
    staleTime: 60_000,
  });
}

const json = { 'content-type': 'application/json' };
const stylePath = (slug: string) => `/v1/styles/${encodeURIComponent(slug)}`;

/** `POST /v1/styles` (admins). Every picker reads the same list, so it is read again. */
export function useCreateStyle() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStyle) =>
      api<ResponseStyle>('/v1/styles', { method: 'POST', headers: json, body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['styles'] }),
  });
}

/** `PATCH /v1/styles/{slug}` (admins). */
export function useUpdateStyle(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateStyle) =>
      api<ResponseStyle>(stylePath(slug), { method: 'PATCH', headers: json, body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['styles'] }),
  });
}

/** `DELETE /v1/styles/{slug}` (admins). `409` while a workspace uses it as its default. */
export function useDeleteStyle(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(stylePath(slug), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['styles'] }),
  });
}
