import type { Answer, PassageSearchResult, PassageWithNeighbours } from '@rag/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';
import { feedbackBody, type Rating } from './feedback';
import { searchPath } from './search';

/**
 * The passages that best match a query, with their scores and no model call. Idle until a search has
 * been submitted, so typing in the box costs nothing.
 */
export function usePassageSearch(slug: string, query: string | null, limit: number) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['workspaces', slug, 'passage-search', query, limit],
    queryFn: async () => (await api<PassageSearchResult>(searchPath(slug, query!, limit))).data,
    enabled: query !== null,
  });
}

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

/**
 * Rates an answer: `POST …/answers/{id}/feedback`. Rating again replaces the earlier rating, which is
 * what pressing the other thumb, or sending a comment after a rating, does.
 */
export function useAnswerFeedback(slug: string) {
  const { api } = useAuth();
  return useMutation({
    mutationFn: ({ answerId, rating, comment }: { answerId: string; rating: Rating; comment: string }) =>
      api<Answer>(
        `/v1/workspaces/${encodeURIComponent(slug)}/answers/${encodeURIComponent(answerId)}/feedback`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(feedbackBody(rating, comment)),
        },
      ),
  });
}
