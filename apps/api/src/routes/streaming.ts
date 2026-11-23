import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpProblem, problem } from '../errors.js';
import { flowProblem } from '../services/flow-errors.js';
import { openEventStream, type SendEvent } from '../sse.js';

type StreamHooks = { onToken: (text: string) => void; signal: AbortSignal };

/**
 * Answer a generating request as server-sent events: `token`* then `citations` and `done`,
 * or `error` (problem JSON plus `<idKey>`, the stored record's id).
 *
 * The stream opens with the first token, so a failure before any text (provider key missing,
 * Langflow down) is still a normal HTTP error response. If the client goes away, the run is
 * aborted.
 */
export async function streamGeneration<T extends { id: string; citations: unknown[] }>(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: {
    what: string;
    idKey: string;
    run: (hooks: StreamHooks) => Promise<{ result: T; error?: unknown }>;
  },
): Promise<void> {
  let send: SendEvent | undefined;
  const open = () => (send ??= openEventStream(req, reply));
  const gone = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) gone.abort(new Error('The client closed the stream.'));
  });

  try {
    const { result, error } = await opts.run({
      signal: gone.signal,
      onToken: (text) => open()('token', { text }),
    });
    if (error) req.log.warn({ err: error, [opts.idKey]: result.id }, `${opts.what} failed`);
    if (error && !send) throw flowProblem(error, opts.what);
    const emit = open();
    if (error) {
      const p = flowProblem(error, opts.what);
      const status = p instanceof HttpProblem ? p.status : 500;
      emit('error', {
        ...problem(req, status, p instanceof HttpProblem ? p.message : undefined),
        [opts.idKey]: result.id,
      });
    } else {
      emit('citations', { citations: result.citations });
      emit('done', result);
    }
  } catch (err) {
    // Before the stream opened, Fastify's error handler answers. After, it can't: report the
    // failure as an event instead, so the client is never left waiting.
    if (!send) throw err;
    req.log.error({ err }, `${opts.what} stream failed`);
    send('error', problem(req, 500));
  } finally {
    if (send) reply.raw.end();
  }
}
