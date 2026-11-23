import { LangflowClient, provisionApiKey } from '@rag/langflow-client';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { REQUIRED_FLOWS } from '../flows.js';
import type { ReadinessCheck } from '../readiness.js';

/** Where the API's Langflow key came from. Shown by `GET /v1/system`. */
export type KeySource = 'auto' | 'env' | 'none';

export type LangflowServiceOptions = {
  config: Pick<
    Config,
    'LANGFLOW_URL' | 'LANGFLOW_SUPERUSER' | 'LANGFLOW_SUPERUSER_PASSWORD' | 'LANGFLOW_API_KEY'
  >;
  log: FastifyBaseLogger;
  client?: LangflowClient;
  /** Delay before retry n (1-based). Injected in tests. */
  retryDelayMs?: (attempt: number) => number;
};

/**
 * Owns the API's connection to Langflow: the client, and getting a key for it.
 *
 * On start the API signs in as the Langflow superuser and mints its own key. If that
 * fails and LANGFLOW_API_KEY is set, it uses that key; otherwise it keeps retrying in
 * the background with backoff, and `/ready` reports Langflow as not ready until it works.
 */
export class LangflowService {
  readonly client: LangflowClient;
  keySource: KeySource = 'none';
  private readonly opts: LangflowServiceOptions;
  private stopped = false;
  private markReady!: () => void;
  /** Resolves once the API has a working key. */
  readonly ready = new Promise<void>((resolve) => (this.markReady = resolve));
  private timer: NodeJS.Timeout | undefined;

  constructor(opts: LangflowServiceOptions) {
    this.opts = opts;
    this.client = opts.client ?? new LangflowClient({ baseUrl: opts.config.LANGFLOW_URL });
  }

  /** Try to get a key now; on failure schedule retries. Resolves after the first attempt. */
  async start(): Promise<void> {
    await this.attempt(1);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async attempt(n: number): Promise<void> {
    if (this.stopped) return;
    const { config, log } = this.opts;
    if (config.LANGFLOW_SUPERUSER_PASSWORD) {
      try {
        const { apiKey, revoked } = await provisionApiKey(this.client, {
          username: config.LANGFLOW_SUPERUSER,
          password: config.LANGFLOW_SUPERUSER_PASSWORD,
        });
        this.client.setApiKey(apiKey);
        this.keySource = 'auto';
        this.markReady();
        log.info({ revoked }, 'created a Langflow API key');
        return;
      } catch (err) {
        log.warn({ err, attempt: n }, 'could not create a Langflow API key');
      }
    }
    if (config.LANGFLOW_API_KEY) {
      this.client.setApiKey(config.LANGFLOW_API_KEY);
      this.keySource = 'env';
      this.markReady();
      log.info('using LANGFLOW_API_KEY from the environment');
      return;
    }
    if (!config.LANGFLOW_SUPERUSER_PASSWORD) {
      log.error('set LANGFLOW_SUPERUSER_PASSWORD or LANGFLOW_API_KEY so the API can call Langflow');
      return;
    }
    const delay = (this.opts.retryDelayMs ?? defaultDelay)(n);
    this.timer = setTimeout(() => void this.attempt(n + 1), delay);
    this.timer.unref();
  }

  /** Ready when Langflow answers, the API has a key, and every flow the API runs is there. */
  readinessCheck(): ReadinessCheck {
    return {
      name: 'langflow',
      check: async (signal) => {
        if (!(await this.client.healthy(signal))) throw new Error('Langflow health check failed');
        if (!this.client.hasApiKey()) throw new Error('no Langflow API key yet');
        const present = new Set((await this.client.listFlows(signal)).map((f) => f.endpoint_name));
        const missing = REQUIRED_FLOWS.filter((f) => !present.has(f));
        if (missing.length) throw new Error(`flows missing in Langflow: ${missing.join(', ')}`);
      },
    };
  }
}

/** 2 s, 4 s, 8 s ... capped at one minute (Langflow's login rate limit window). */
const defaultDelay = (attempt: number) => Math.min(60_000, 1000 * 2 ** attempt);
