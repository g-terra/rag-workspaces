/** An error response from the API, with the problem JSON's `detail` (or the status text) as its message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientDeps {
  /** The current access token, or null when signed out. */
  getToken(): Promise<string | null>;
  /** Called on a 401: the session is gone, so the app signs the person out. */
  onUnauthorized(): void;
  fetch?: typeof globalThis.fetch;
}

export type ApiFetch = <T>(path: string, init?: RequestInit) => Promise<T>;

/**
 * `apiFetch('/v1/me')` calls `/api/v1/me` on this origin (nginx, or Vite in development, forwards it to
 * the API) with the bearer token, and returns the parsed JSON body.
 */
export function createApiClient({
  getToken,
  onUnauthorized,
  fetch = globalThis.fetch,
}: ApiClientDeps): ApiFetch {
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    const token = await getToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(`/api${path}`, { ...init, headers });
    if (res.status === 401) onUnauthorized();
    if (!res.ok) throw new ApiError(res.status, await problemMessage(res));
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  };
}

async function problemMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string; title?: string };
    return body.detail ?? body.title ?? res.statusText;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}
