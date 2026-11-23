import type { Problem } from '@rag/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** An error a route throws on purpose; becomes an RFC 9457 problem response. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    detail?: string,
    readonly type = 'about:blank',
    /** Extra response headers, such as `Retry-After`. */
    readonly headers: Record<string, string> = {},
  ) {
    super(detail ?? TITLES[status] ?? 'Error');
  }
}

export function problem(
  req: FastifyRequest,
  status: number,
  detail?: string,
  extra?: Partial<Problem>,
): Problem {
  return {
    type: 'about:blank',
    title: TITLES[status] ?? 'Error',
    status,
    ...(detail ? { detail } : {}),
    requestId: req.id,
    ...extra,
  };
}

export function errorHandler(err: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(err)) {
    const errors = err.validation.map((v) => ({
      path: [err.validationContext, ...v.instancePath.split('/').filter(Boolean)].join('.'),
      message: v.message ?? 'invalid',
    }));
    return reply
      .status(400)
      .type('application/problem+json')
      .send(problem(req, 400, 'The request did not match the schema.', { errors }));
  }
  if (err instanceof HttpProblem) {
    if (err.status === 401) reply.header('www-authenticate', 'Bearer realm="rag-workspaces"');
    reply.headers(err.headers);
    return reply
      .status(err.status)
      .type('application/problem+json')
      .send(problem(req, err.status, err.message, { type: err.type }));
  }
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) req.log.error({ err }, 'request failed');
  // Never leak internals in a 5xx; the request id leads to the log line.
  const detail = status >= 500 ? undefined : err.message;
  return reply
    .status(status)
    .type('application/problem+json')
    .send(problem(req, status, detail));
}

export function notFoundHandler(req: FastifyRequest, reply: FastifyReply) {
  return reply
    .status(404)
    .type('application/problem+json')
    .send(problem(req, 404, `No route for ${req.method} ${req.url.split('?')[0]}`));
}
