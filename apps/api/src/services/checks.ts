import type { Config } from '../config.js';
import type { ReadinessCheck } from '../readiness.js';

/** GET a URL and require a 2xx answer. */
function httpCheck(name: string, url: string, fetchFn: typeof fetch = fetch): ReadinessCheck {
  return {
    name,
    check: async (signal) => {
      const res = await fetchFn(url, { signal });
      if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
    },
  };
}

/** Keycloak answers and our realm exists (its discovery document is served). */
export function keycloakCheck(
  config: Pick<Config, 'KEYCLOAK_INTERNAL_URL' | 'KEYCLOAK_REALM'>,
  fetchFn?: typeof fetch,
): ReadinessCheck {
  const base = config.KEYCLOAK_INTERNAL_URL.replace(/\/+$/, '');
  return httpCheck(
    'keycloak',
    `${base}/realms/${encodeURIComponent(config.KEYCLOAK_REALM)}/.well-known/openid-configuration`,
    fetchFn,
  );
}
