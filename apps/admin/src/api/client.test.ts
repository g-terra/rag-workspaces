import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';

const json = (status: number, body: unknown, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

function setup(response: Response, token: string | null = 'tok') {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  const onUnauthorized = vi.fn();
  const apiFetch = createApiClient({ getToken: async () => token, onUnauthorized, fetch });
  return { apiFetch, fetch, onUnauthorized };
}

describe('apiFetch', () => {
  it('calls /api with the bearer token and returns the JSON body', async () => {
    const { apiFetch, fetch } = setup(json(200, { name: 'Ada' }));
    await expect(apiFetch('/v1/me')).resolves.toEqual({ name: 'Ada' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/me');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
  });

  it('sends no Authorization header without a token', async () => {
    const { apiFetch, fetch } = setup(json(200, {}), null);
    await apiFetch('/v1/me');
    expect(new Headers(fetch.mock.calls[0]![1]?.headers).has('authorization')).toBe(false);
  });

  it('returns undefined for 204 No Content', async () => {
    const { apiFetch } = setup(new Response(null, { status: 204 }));
    await expect(apiFetch('/v1/workspaces/ouc')).resolves.toBeUndefined();
  });

  it('turns problem JSON into an ApiError with its detail', async () => {
    const { apiFetch } = setup(
      json(404, { title: 'Not Found', status: 404, detail: 'No workspace "x".' }, 'application/problem+json'),
    );
    const err = await apiFetch('/v1/workspaces/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, message: 'No workspace "x".' });
  });

  it('still throws an ApiError when the error body is not JSON', async () => {
    const { apiFetch } = setup(new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }));
    await expect(apiFetch('/v1/me')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
  });

  it('reports a 401 so the session can end, and throws', async () => {
    const { apiFetch, onUnauthorized } = setup(json(401, { title: 'Unauthorized', status: 401 }));
    await expect(apiFetch('/v1/me')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
