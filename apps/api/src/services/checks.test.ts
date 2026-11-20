import { describe, expect, it } from 'vitest';
import { chromaCheck, keycloakCheck } from './checks.js';

const signal = new AbortController().signal;

function recordingFetch(status: number) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response('{}', { status });
  }) as typeof fetch;
  return { fn, urls };
}

describe('dependency checks', () => {
  it('checks Chroma through its heartbeat', async () => {
    const { fn, urls } = recordingFetch(200);
    await chromaCheck({ CHROMA_URL: 'http://chroma:8000/' }, fn).check(signal);
    expect(urls).toEqual(['http://chroma:8000/api/v2/heartbeat']);
  });

  it("checks Keycloak's realm on the internal URL", async () => {
    const { fn, urls } = recordingFetch(200);
    await keycloakCheck(
      { KEYCLOAK_INTERNAL_URL: 'http://keycloak:8080', KEYCLOAK_REALM: 'rag-workspaces' },
      fn,
    ).check(signal);
    expect(urls).toEqual(['http://keycloak:8080/realms/rag-workspaces/.well-known/openid-configuration']);
  });

  it('fails on a non-2xx answer', async () => {
    const { fn } = recordingFetch(404);
    await expect(
      keycloakCheck({ KEYCLOAK_INTERNAL_URL: 'http://keycloak:8080', KEYCLOAK_REALM: 'nope' }, fn).check(
        signal,
      ),
    ).rejects.toThrow(/HTTP 404/);
  });
});
