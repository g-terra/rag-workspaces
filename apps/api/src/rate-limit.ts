import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from './config.js';
import { HttpProblem } from './errors.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The route runs a model (embedding or generation) and also counts against the model limit. */
    modelCall?: boolean;
  }
}

type Window = { count: number; resetAt: number };
export type Hit = { allowed: boolean; limit: number; remaining: number; resetSeconds: number };

/** Fixed one-minute windows per key, in memory: there is one API process (docs/architecture.md). */
export class FixedWindow {
  private readonly windows = new Map<string, Window>();

  constructor(
    readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): Hit {
    const now = this.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      if (this.windows.size > 10_000) this.prune(now);
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    return {
      allowed: w.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - w.count),
      resetSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
    };
  }

  private prune(now: number) {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }
}

export type RateLimitOptions = {
  config: Pick<Config, 'RATE_LIMIT_PER_MINUTE' | 'RATE_LIMIT_MODEL_PER_MINUTE'>;
  now?: () => number;
};

/**
 * Per person and per API key, so a looping agent can't starve the one local model.
 *
 * Every `/v1` request from a signed-in caller counts against `RATE_LIMIT_PER_MINUTE`; routes
 * marked `config.modelCall` count against `RATE_LIMIT_MODEL_PER_MINUTE` too. Responses carry
 * `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds) for the tighter of
 * the two; over a limit the answer is `429` with `Retry-After`. Anonymous requests are not
 * counted: they get `401` before they cost anything. Registered after auth, so the principal
 * is known.
 */
const plugin: FastifyPluginAsync<RateLimitOptions> = async (app, { config, now }) => {
  const all = config.RATE_LIMIT_PER_MINUTE
    ? new FixedWindow(config.RATE_LIMIT_PER_MINUTE, 60_000, now)
    : null;
  const model = config.RATE_LIMIT_MODEL_PER_MINUTE
    ? new FixedWindow(config.RATE_LIMIT_MODEL_PER_MINUTE, 60_000, now)
    : null;
  if (!all && !model) return;

  app.addHook('onRequest', async (req, reply) => {
    const key = callerKey(req);
    if (!key || !req.url.startsWith('/v1/')) return;
    const hits: { hit: Hit; what: string }[] = [];
    if (all) hits.push({ hit: all.hit(key), what: 'requests' });
    if (model && req.routeOptions.config?.modelCall) {
      hits.push({ hit: model.hit(key), what: 'searches, answers and chat messages' });
    }
    if (!hits.length) return;
    const blocked = hits.find((h) => !h.hit.allowed);
    const shown = blocked ?? hits.reduce((a, b) => (b.hit.remaining < a.hit.remaining ? b : a));
    reply.headers({
      'ratelimit-limit': String(shown.hit.limit),
      'ratelimit-remaining': String(shown.hit.remaining),
      'ratelimit-reset': String(shown.hit.resetSeconds),
    });
    if (blocked) {
      throw new HttpProblem(
        429,
        `Too many ${blocked.what}: the limit is ${blocked.hit.limit} a minute. Try again in ${blocked.hit.resetSeconds} s.`,
        undefined,
        { 'retry-after': String(blocked.hit.resetSeconds) },
      );
    }
  });
};

function callerKey(req: FastifyRequest): string | null {
  const p = req.principal;
  return p ? `${p.kind}:${p.id}` : null;
}

export const rateLimits = fp(plugin, { name: 'rate-limits', dependencies: ['auth'] });
