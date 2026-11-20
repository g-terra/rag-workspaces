import type { FastifyReply, FastifyRequest } from 'fastify';

export type SendEvent = (event: string, data: unknown) => void;

/**
 * Take the response over from Fastify and start a server-sent events stream. After this,
 * errors can only be reported as events, so call it as late as possible.
 */
export function openEventStream(req: FastifyRequest, reply: FastifyReply): SendEvent {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-request-id': req.id,
    // Tell nginx not to buffer the stream.
    'x-accel-buffering': 'no',
  });
  return (event, data) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

/** True when the caller asked for a stream (`Accept: text/event-stream`). */
export function wantsEventStream(req: FastifyRequest): boolean {
  return (req.headers.accept ?? '').includes('text/event-stream');
}
