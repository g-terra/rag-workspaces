/** A REST API answer that wasn't 2xx, with the problem's `detail` when the API sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`HTTP ${status}: ${detail}`);
  }
}

export type ApiOptions = { baseUrl: string; apiKey: string; fetch?: typeof fetch; timeoutMs?: number };

/**
 * The few rag-workspaces API calls the MCP tools make, with an `rw_` API key. The key's role
 * and workspaces decide what an agent can see, exactly as for any other caller.
 */
export class RagApi {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: ApiOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.fetchFn = opts.fetch ?? fetch;
  }

  get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
    const qs = params.size ? `?${params}` : '';
    return this.request<T>('GET', `${path}${qs}`);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Answers from a local model can take a while.
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 200_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 500) || res.statusText;
      try {
        const problem = JSON.parse(text) as { detail?: string; title?: string };
        detail = problem.detail ?? problem.title ?? detail;
      } catch {
        // Not JSON: keep the text.
      }
      const wait = res.headers.get('retry-after');
      throw new ApiError(res.status, wait ? `${detail} (retry after ${wait} s)` : detail);
    }
    return (text ? JSON.parse(text) : null) as T;
  }
}
