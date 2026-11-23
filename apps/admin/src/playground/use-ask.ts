import type { Answer } from '@rag/shared';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAuth } from '@/auth/auth-context';
import { askReducer, idleAsk, type AskState } from './ask';
import { streamGeneration } from './stream';

export type Ask = AskState & {
  ask(question: string, maxPassages: number): void;
  /** Aborts the request; whatever had streamed stays on screen. */
  stop(): void;
};

/** Asks `POST /v1/workspaces/{slug}/answers` and streams the answer into `AskState`. */
export function useAsk(slug: string): Ask {
  const auth = useAuth();
  const [state, dispatch] = useReducer(askReducer, idleAsk);
  const running = useRef<AbortController | null>(null);

  // Leaving the page (or switching workspace) ends the request, so no tokens arrive for a gone screen.
  useEffect(() => () => running.current?.abort(), []);

  const ask = useCallback(
    (question: string, maxPassages: number) => {
      running.current?.abort();
      const controller = new AbortController();
      running.current = controller;
      dispatch({ type: 'started', question });
      void streamGeneration<Answer>({
        path: `/v1/workspaces/${encodeURIComponent(slug)}/answers`,
        body: { question, maxPassages },
        auth,
        signal: controller.signal,
        idKey: 'answerId',
        onToken: (text) => dispatch({ type: 'token', text }),
      }).then((outcome) => {
        if (outcome.kind === 'done') dispatch({ type: 'done', answer: outcome.result });
        else if (outcome.kind === 'failed') dispatch({ type: 'failed', detail: outcome.detail });
      });
    },
    [auth, slug],
  );

  const stop = useCallback(() => {
    running.current?.abort();
    dispatch({ type: 'stopped' });
  }, []);

  return { ...state, ask, stop };
}
