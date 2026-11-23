import type { PassageWithNeighbours } from '@rag/shared';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';

/** One passage with the passages around it, for a citation preview. Idle until a citation is opened. */
export function usePassage(slug: string, passageId: string | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['workspaces', slug, 'passages', passageId],
    queryFn: () =>
      api<PassageWithNeighbours>(
        `/v1/workspaces/${encodeURIComponent(slug)}/passages/${encodeURIComponent(passageId!)}`,
      ),
    enabled: passageId !== null,
  });
}
