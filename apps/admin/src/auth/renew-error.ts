import { ErrorResponse } from 'oidc-client-ts';

/**
 * Whether a failed token renewal means the session is over (Keycloak answered with an OAuth error such
 * as `invalid_grant`), as opposed to Keycloak being briefly unreachable, when the session should be kept
 * and renewal tried again.
 */
export function isSessionRefused(err: unknown): boolean {
  return err instanceof ErrorResponse;
}
