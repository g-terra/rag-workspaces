import { LangflowError, errorDetail } from './errors.js';
import type { RunResponse } from './output.js';

/** Per-request inputs for named nodes: `{ [nodeId]: { [field]: value } }`. Node ids are the contract (POC F5). */
export type Tweaks = Record<string, Record<string, unknown>>;

export type RunRequest = {
  input_value?: string;
  /** Always set one (the conversation id, or a fresh id); without it every run shares a session (POC F8). */
  session_id: string;
  tweaks?: Tweaks;
};

export type FlowSummary = { id: string; name: string; endpoint_name: string | null };

export type ApiKeySummary = { id: string; name: string };

export type LangflowClientOptions = {
  baseUrl: string;
  /** Langflow API key (`sk-...`) for run and flow calls. Can be set later with `setApiKey`. */
  apiKey?: string;
  fetch?: typeof fetch;
  /** Waits between login retries when Langflow rate-limits `/login`. Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class LangflowClient {
  readonly baseUrl: string;
  private apiKey: string | undefined;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: LangflowClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  hasApiKey() {
    return Boolean(this.apiKey);
  }

  // --- plumbing -----------------------------------------------------------------------------------

  private async request(
    operation: string,
    path: string,
    init: RequestInit & { auth?: 'key' | { bearer: string } | 'none' } = {},
  ): Promise<Response> {
    const { auth = 'key', headers, ...rest } = init;
    const h = new Headers(headers);
    if (auth === 'key') {
      if (!this.apiKey) throw new LangflowError(operation, 0, 'no Langflow API key yet');
      h.set('x-api-key', this.apiKey);
    } else if (auth !== 'none') {
      h.set('authorization', `Bearer ${auth.bearer}`);
    }
    const res = await this.fetch(`${this.baseUrl}${path}`, { ...rest, headers: h });
    if (!res.ok) throw new LangflowError(operation, res.status, errorDetail(await res.text()));
    return res;
  }

  private json(body: unknown): RequestInit {
    return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
  }

  // --- health and auth ----------------------------------------------------------------------------

  /** True when Langflow's own health check answers. */
  async healthy(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await this.fetch(`${this.baseUrl}/health_check`, { signal: signal ?? null });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Log in as a Langflow user (auto-login is off) and return a short-lived access token.
   * Langflow rate-limits `/login` with 429 and `retry_after` seconds; honour it a few times (POC F4).
   */
  async login(username: string, password: string, attempts = 4): Promise<string> {
    for (let i = 1; ; i++) {
      const res = await this.fetch(`${this.baseUrl}/api/v1/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password }),
      });
      if (res.status === 429 && i < attempts) {
        const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
        await this.sleep(Number(body.retry_after ?? 60) * 1000);
        continue;
      }
      if (!res.ok) throw new LangflowError('login', res.status, errorDetail(await res.text()));
      return ((await res.json()) as { access_token: string }).access_token;
    }
  }

  async createApiKey(token: string, name: string): Promise<string> {
    const res = await this.request('create API key', '/api/v1/api_key/', {
      method: 'POST',
      auth: { bearer: token },
      ...this.json({ name }),
    });
    return ((await res.json()) as { api_key: string }).api_key;
  }

  async listApiKeys(token: string): Promise<ApiKeySummary[]> {
    const res = await this.request('list API keys', '/api/v1/api_key/', { auth: { bearer: token } });
    const body = (await res.json()) as { api_keys?: ApiKeySummary[] } | ApiKeySummary[];
    return Array.isArray(body) ? body : (body.api_keys ?? []);
  }

  async deleteApiKey(token: string, id: string): Promise<void> {
    await this.request('delete API key', `/api/v1/api_key/${id}`, {
      method: 'DELETE',
      auth: { bearer: token },
    });
  }

  // --- flows --------------------------------------------------------------------------------------

  /** The flows owned by the key's user (our flows, imported from `flows/`). */
  async listFlows(signal?: AbortSignal): Promise<FlowSummary[]> {
    const res = await this.request('list flows', '/api/v1/flows/?header_flows=true&get_all=true', {
      signal: signal ?? null,
    });
    const flows = (await res.json()) as FlowSummary[];
    return flows.map(({ id, name, endpoint_name }) => ({ id, name, endpoint_name: endpoint_name ?? null }));
  }

  /** Run a flow by endpoint name and wait for the whole result. */
  async run(flow: string, req: RunRequest, signal?: AbortSignal): Promise<RunResponse> {
    const res = await this.request(`run ${flow}`, `/api/v1/run/${encodeURIComponent(flow)}?stream=false`, {
      method: 'POST',
      signal: signal ?? null,
      ...this.json({ input_type: 'chat', output_type: 'chat', ...req }),
    });
    return (await res.json()) as RunResponse;
  }
}
