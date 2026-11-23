import type { ZodType } from 'zod';
import { z } from 'zod';
import { problemDetail } from '@/api/problem';
import { createSseParser } from '@/api/sse';
import { sendAuthorized, type TokenSource } from '@/auth/authorized';

export interface GenerationRequest<T> {
  /** The API path without the `/api` prefix, e.g. `/v1/workspaces/ouc/answers`. */
  path: string;
  body: unknown;
  /** What the `done` event carries, so a record of the wrong shape is a failure, not a crash. */
  result: ZodType<T>;
  auth: TokenSource;
  /** Aborting it ends the request; the outcome is then `aborted`. */
  signal: AbortSignal;
  onToken(text: string): void;
  fetch?: typeof globalThis.fetch;
}

export type GenerationOutcome<T> =
  | { kind: 'done'; result: T }
  /** The API refused, or the run failed. `status` is the HTTP status, when the API gave one. */
  | { kind: 'failed'; status: number | null; detail: string }
  /** The caller aborted, or the session ended; nothing to show. */
  | { kind: 'aborted' };

const Token = z.object({ text: z.string() });
const Problem = z.object({
  status: z.number().int().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
});

/**
 * Asks the API to generate something and streams the result: `POST <path>` with
 * `Accept: text/event-stream`, then `token` events through `onToken` until `done` (the stored record)
 * or `error` (problem JSON). Reads with `fetch` because `EventSource` can neither send the bearer token
 * nor post a body.
 *
 * A failure before the stream opens is a normal HTTP error, so its problem JSON is read instead.
 */
export async function streamGeneration<T>({
  path,
  body,
  result,
  auth,
  signal,
  onToken,
  fetch = globalThis.fetch,
}: GenerationRequest<T>): Promise<GenerationOutcome<T>> {
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
    if (!res.ok) return { kind: 'failed', status: res.status, detail: await problemDetail(res) };
    if (!res.body) return { kind: 'failed', status: res.status, detail: 'The answer was empty.' };

    const parse = createSseParser();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let outcome: GenerationOutcome<T> | null = null;
    // Stops at the first `done` or `error` rather than waiting for the server to close the
    // connection, so an intermediary holding the socket open can't leave the caller streaming forever.
    while (!outcome) {
      const { done, value } = await reader.read();
      if (done) break;
      // `citations` is ignored: the `done` record carries the same citations.
      for (const event of parse(value)) {
        if (event.event === 'token') {
          const token = Token.safeParse(json(event.data));
          if (token.success) onToken(token.data.text);
        } else if (event.event === 'done') {
          const record = result.safeParse(json(event.data));
          outcome = record.success
            ? { kind: 'done', result: record.data }
            : { kind: 'failed', status: null, detail: 'The answer came back in an unexpected shape.' };
        } else if (event.event === 'error') {
          outcome = failure(json(event.data));
        }
      }
    }
    void reader.cancel().catch(() => {});
    return outcome ?? { kind: 'failed', status: null, detail: 'The answer stopped before it finished.' };
  } catch (err) {
    if (signal.aborted) return { kind: 'aborted' };
    return {
      kind: 'failed',
      status: null,
      detail: err instanceof Error ? err.message : 'The request failed.',
    };
  }
}

function json(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function failure<T>(data: unknown): GenerationOutcome<T> {
  const problem = Problem.safeParse(data);
  const body = problem.success ? problem.data : {};
  return {
    kind: 'failed',
    status: body.status ?? null,
    detail: body.detail ?? body.title ?? 'The answer failed.',
  };
}
