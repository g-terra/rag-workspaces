import type { StyleList } from '@rag/shared';
import { useQuery } from '@tanstack/react-query';
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
