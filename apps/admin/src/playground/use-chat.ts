import { Conversation, Message } from '@rag/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError, type ApiFetch } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { styleRequest, WORKSPACE_DEFAULT } from '@/styles/styles';
import { chatReducer, idleChat, type ChatState } from './chat';
import type { AnswerError } from './failure';
import { streamGeneration } from './stream';

export type Chat = ChatState & {
  /** The conversation the thread is stored in; null until the first message created one. */
  conversationId: string | null;
  /** `style` is the style picker's value (see `styleRequest`); left out, the workspace's default. */
  send(content: string, style?: string): void;
  /** Aborts the reply; whatever had streamed stays on screen. */
  stop(): void;
  /** Starts a new, empty conversation: the next message creates it. */
  reset(): void;
};

/**
 * A conversation in the playground. Without an `existing` id the first message creates the conversation
 * (`POST /v1/workspaces/{slug}/conversations`); either way every message streams its reply from
 * `POST …/conversations/{id}/messages`. The API keeps the history, so only the new message is sent.
 *
 * `existing` is read once, so a screen that moves between conversations keys this hook by the id it
 * continues, the way the playground keys its panels by workspace.
 */
export function useChat(slug: string, existing: string | null = null): Chat {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(chatReducer, idleChat);
  const [conversationId, setConversationId] = useState<string | null>(existing);
  // The id the next message needs, which is set before the state the screen reads has caught up.
  const conversation = useRef<string | null>(existing);
  const running = useRef<AbortController | null>(null);

  // Leaving the page (or switching workspace) ends the request, so no tokens arrive for a gone screen.
  useEffect(() => () => running.current?.abort(), []);

  const send = useCallback(
    (content: string, style: string = WORKSPACE_DEFAULT) => {
      running.current?.abort();
      const controller = new AbortController();
      running.current = controller;
      dispatch({ type: 'sent', question: content });
      void (async () => {
        const id =
          conversation.current ??
          (await start(auth.api, slug, controller.signal, (error) => dispatch({ type: 'failed', error })));
        if (id === null) return;
        conversation.current = id;
        setConversationId(id);
        const outcome = await streamGeneration({
          path: `/v1/workspaces/${encodeURIComponent(slug)}/conversations/${encodeURIComponent(id)}/messages`,
          body: { content, ...styleRequest(style) },
          result: Message,
          auth,
          signal: controller.signal,
          onToken: (text) => dispatch({ type: 'token', text }),
        });
        if (outcome.kind === 'done') {
          dispatch({ type: 'done', reply: outcome.result });
          // Refresh only the list so updatedAt and order stay current without refetching an open thread.
          void queryClient.invalidateQueries({
            queryKey: ['workspaces', slug, 'conversations'],
            exact: true,
          });
        } else if (outcome.kind === 'failed') {
          dispatch({ type: 'failed', error: outcome });
          // A 503 is how the API answers while a workspace is reindexed, so read its status again:
          // what the failure means depends on it, and the copy we loaded may predate the reindex.
          // `exact` keeps this from refetching an open conversation detail query and showing turns twice.
          if (outcome.status === 503) {
            void queryClient.invalidateQueries({ queryKey: ['workspaces', slug], exact: true });
          }
        }
      })();
    },
    [auth, queryClient, slug],
  );

  const stop = useCallback(() => {
    running.current?.abort();
    dispatch({ type: 'stopped' });
  }, []);

  const reset = useCallback(() => {
    running.current?.abort();
    conversation.current = null;
    setConversationId(null);
    dispatch({ type: 'cleared' });
  }, []);

  return { ...state, conversationId, send, stop, reset };
}

/**
 * Creates the conversation the first message needs. Returns null when it could not be created, having
 * reported why on the turn: there is no reply to stream without a conversation to put it in.
 */
async function start(
  api: ApiFetch,
  slug: string,
  signal: AbortSignal,
  onFailed: (error: AnswerError) => void,
): Promise<string | null> {
  try {
    const created = await api<Conversation>(`/v1/workspaces/${encodeURIComponent(slug)}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal,
    });
    // Stopping while the conversation was being created leaves it empty, which costs nothing.
    return signal.aborted ? null : Conversation.parse(created).id;
  } catch (err) {
    if (signal.aborted) return null;
    // A 401 has already signed the person out, and signing in again starts a new page: saying the
    // conversation failed would blame the message for a session that had ended, as streaming does not.
    if (err instanceof ApiError && err.status === 401) return null;
    onFailed({
      status: err instanceof ApiError ? err.status : null,
      detail: err instanceof Error ? err.message : 'The conversation could not be started.',
    });
    return null;
  }
}
