import type { Conversation, ConversationWithMessages } from '@rag/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/auth-context';

const path = (slug: string) => `/v1/workspaces/${encodeURIComponent(slug)}/conversations`;
const listKey = (slug: string) => ['workspaces', slug, 'conversations'];

interface Page {
  data: Conversation[];
  nextCursor: string | null;
}

/**
 * Your conversations in this workspace, most recently active first, a page at a time: the API answers
 * with a cursor for the next page, which "Load more" asks for.
 */
export function useConversations(slug: string) {
  const { api } = useAuth();
  return useInfiniteQuery({
    queryKey: listKey(slug),
    queryFn: ({ pageParam }) =>
      api<Page>(`${path(slug)}?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor,
    select: (pages) => pages.pages.flatMap((p) => p.data),
  });
}

/** One conversation with all its messages, oldest first. Idle until one is opened. */
export function useConversation(slug: string, id: string | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: ['workspaces', slug, 'conversations', id],
    queryFn: () => api<ConversationWithMessages>(`${path(slug)}/${encodeURIComponent(id!)}`),
    enabled: id !== null,
  });
}

/** Deletes a conversation and its messages, then drops it from the list. */
export function useDeleteConversation(slug: string) {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`${path(slug)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: listKey(slug) }),
  });
}
