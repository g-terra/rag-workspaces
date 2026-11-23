import { sendAuthorized, type TokenSource } from '@/auth/authorized';
import { toDocumentEvent, type DocumentEvent } from './events';
import { createSseParser, reconnectDelay } from './sse';
import { failureDetail } from './upload';

export interface FollowOptions {
  slug: string;
  auth: TokenSource;
  onEvent(e: DocumentEvent): void;
  /** The API refused the stream for good (403, 404), with its reason; no more attempts follow. */
  onStop(reason: string): void;
  /** Aborting it ends the request, any wait, and the loop. */
  signal: AbortSignal;
  fetch?: typeof globalThis.fetch;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Follows `GET /v1/workspaces/{slug}/documents/events` until `signal` aborts, calling `onEvent` for each
 * event about this workspace. Reads with `fetch` because `EventSource` can't send the bearer token. When
 * the stream drops it reconnects with backoff and a fresh token; each snapshot resets the backoff. A 401
 * renews the token once, then ends the session; a 403 or 404 stops with `onStop`.
 */
export async function followDocumentEvents({
  slug,
  auth,
  onEvent,
  onStop,
  signal,
  fetch = globalThis.fetch,
  wait = sleep,
}: FollowOptions): Promise<void> {
  const url = `/api/v1/workspaces/${encodeURIComponent(slug)}/documents/events`;
  let attempt = 0;
  while (!signal.aborted) {
    try {
      const res = await sendAuthorized(auth, (token) =>
        fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal }),
      );
      // sendAuthorized has ended the session; signing in again starts a new page.
      if (res.status === 401) return;
      if (res.status === 403 || res.status === 404) {
        onStop(await refusal(res));
        return;
      }
      if (res.ok && res.body) {
        const parse = createSseParser();
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const raw of parse(value)) {
            const event = forWorkspace(toDocumentEvent(raw), slug);
            if (!event || signal.aborted) continue;
            if (event.type === 'snapshot') attempt = 0;
            onEvent(event);
          }
        }
      }
    } catch {
      // Dropped, failed or aborted: retry below unless aborted.
    }
    if (signal.aborted) return;
    await wait(reconnectDelay(attempt++), signal);
  }
}

/** Drops documents from another workspace; a stream only ever has its own, so this is a guard. */
function forWorkspace(event: DocumentEvent | null, slug: string): DocumentEvent | null {
  if (event?.type === 'document') return event.document.workspace === slug ? event : null;
  if (event?.type === 'snapshot')
    return { ...event, documents: event.documents.filter((d) => d.workspace === slug) };
  return event;
}

async function refusal(res: Response): Promise<string> {
  let body: { detail?: string; title?: string } | null = null;
  try {
    body = (await res.json()) as { detail?: string; title?: string };
  } catch {
    // No problem JSON: use the status.
  }
  return failureDetail(body, res.status, res.statusText);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
