import { useEffect, useEffectEvent } from 'react';
import { useAuth } from '@/auth/auth-context';
import { toDocumentEvent, type DocumentEvent } from './events';
import { createSseParser, reconnectDelay } from './sse';

/**
 * Follows `GET /v1/workspaces/{slug}/documents/events` while the component is mounted, calling `onEvent`
 * for each event. Reads with `fetch` because `EventSource` can't send the bearer token. When the stream
 * drops it reconnects with backoff and a fresh token; the snapshot sent on connect fills any gap.
 */
export function useDocumentEvents(slug: string, onEvent: (e: DocumentEvent) => void) {
  const { getToken } = useAuth();
  const emit = useEffectEvent(onEvent);

  useEffect(() => {
    const abort = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      try {
        const token = await getToken();
        const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(slug)}/documents/events`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const parse = createSseParser();
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const raw of parse(value)) {
            const event = toDocumentEvent(raw);
            if (!event) continue;
            if (event.type === 'snapshot') attempt = 0;
            emit(event);
          }
        }
      } catch {
        // Dropped, refused or aborted: retry below unless the component is gone.
      }
      if (abort.signal.aborted) return;
      timer = setTimeout(() => void connect(), reconnectDelay(attempt++));
    }

    void connect();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [slug, getToken]);
}
