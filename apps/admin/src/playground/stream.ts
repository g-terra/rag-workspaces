import { problemDetail } from '@/api/problem';
import { createSseParser } from '@/api/sse';
import { sendAuthorized, type TokenSource } from '@/auth/authorized';

export interface GenerationRequest {
  /** The API path without the `/api` prefix, e.g. `/v1/workspaces/ouc/answers`. */
  path: string;
  body: unknown;
  auth: TokenSource;
  /** Aborting it ends the request; the outcome is then `aborted`. */
  signal: AbortSignal;
  /** The field the `error` event carries the stored record's id in: `answerId` or `messageId`. */
  idKey: string;
  onToken(text: string): void;
  fetch?: typeof globalThis.fetch;
}

export type GenerationOutcome<T> =
  | { kind: 'done'; result: T }
  /** The API refused or the run failed; `id` is the stored (failed) record, when the API named one. */
  | { kind: 'failed'; detail: string; id: string | null }
  /** The caller aborted, or the session ended; nothing to show. */
  | { kind: 'aborted' };

/**
 * Asks the API to generate something and streams the result: `POST <path>` with
 * `Accept: text/event-stream`, then `token` events through `onToken` until `done` (the stored record) or
 * `error` (problem JSON plus the record's id). Reads with `fetch` because `EventSource` can't send the
 * bearer token, and because the request has a body.
 *
 * A failure before the stream opens is a normal HTTP error, so its problem JSON is read instead.
 */
export async function streamGeneration<T>({
  path,
  body,
  auth,
  signal,
  idKey,
  onToken,
  fetch = globalThis.fetch,
}: GenerationRequest): Promise<GenerationOutcome<T>> {
  try {
    const res = await sendAuthorized(auth, (token) =>
      fetch(`/api${path}`, {
        method: 'POST',
        signal,
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
    // sendAuthorized has ended the session; signing in again starts a new page.
    if (res.status === 401) return { kind: 'aborted' };
    if (!res.ok || !res.body) return { kind: 'failed', detail: await problemDetail(res), id: null };

    const parse = createSseParser();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let outcome: GenerationOutcome<T> | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parse(value)) {
        // `citations` is ignored: the `done` record carries the same citations.
        if (event.event === 'token') onToken((JSON.parse(event.data) as { text: string }).text);
        else if (event.event === 'done') outcome = { kind: 'done', result: JSON.parse(event.data) as T };
        else if (event.event === 'error') outcome = failure(event.data, idKey);
      }
    }
    return outcome ?? { kind: 'failed', detail: 'The answer stopped before it finished.', id: null };
  } catch (err) {
    if (signal.aborted) return { kind: 'aborted' };
    return { kind: 'failed', detail: err instanceof Error ? err.message : 'The request failed.', id: null };
  }
}

function failure<T>(data: string, idKey: string): GenerationOutcome<T> {
  const body = JSON.parse(data) as Record<string, unknown>;
  const detail = typeof body.detail === 'string' ? body.detail : undefined;
  const title = typeof body.title === 'string' ? body.title : undefined;
  const id = body[idKey];
  return {
    kind: 'failed',
    detail: detail ?? title ?? 'The answer failed.',
    id: typeof id === 'string' ? id : null,
  };
}
