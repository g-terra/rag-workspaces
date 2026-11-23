import { ErrorResponse } from 'oidc-client-ts';
import { describe, expect, it } from 'vitest';
import { isSessionRefused } from './renew-error';

describe('isSessionRefused', () => {
  it('is true when Keycloak answers with an OAuth error such as invalid_grant', () => {
    expect(isSessionRefused(new ErrorResponse({ error: 'invalid_grant' }))).toBe(true);
  });

  it('is false for a network failure, so a Keycloak restart does not end the session', () => {
    expect(isSessionRefused(new TypeError('Failed to fetch'))).toBe(false);
  });
});
