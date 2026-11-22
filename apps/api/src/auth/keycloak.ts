import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import { InvalidCredentials, type Authenticator, type UserPrincipal } from './principal.js';

type KeycloakClaims = JWTPayload & {
  preferred_username?: string;
  email?: string;
  name?: string;
  realm_access?: { roles?: string[] };
};

export type KeycloakOptions = {
  /** Expected `iss`: the public URL, because that is what Keycloak writes into tokens. */
  issuer: string;
  audience: string;
  /** Where signing keys come from. In production: the JWKS on Keycloak's internal URL. */
  keys: JWTVerifyGetKey;
};

/**
 * The issuer split (docs/architecture.md, Auth): keys are fetched from Keycloak's internal
 * URL (`keycloak:8080`), but the issuer is checked against the public URL (`localhost:8081`),
 * because Keycloak always writes the public one into tokens.
 */
export function keycloakOptionsFromConfig(
  config: Pick<
    Config,
    'KEYCLOAK_INTERNAL_URL' | 'KEYCLOAK_PUBLIC_URL' | 'KEYCLOAK_REALM' | 'KEYCLOAK_AUDIENCE'
  >,
): KeycloakOptions {
  const realm = encodeURIComponent(config.KEYCLOAK_REALM);
  const internal = config.KEYCLOAK_INTERNAL_URL.replace(/\/+$/, '');
  const publicUrl = config.KEYCLOAK_PUBLIC_URL.replace(/\/+$/, '');
  return {
    issuer: `${publicUrl}/realms/${realm}`,
    audience: config.KEYCLOAK_AUDIENCE,
    // jose caches the key set and refetches when it sees an unknown key id (key rotation).
    keys: createRemoteJWKSet(new URL(`${internal}/realms/${realm}/protocol/openid-connect/certs`)),
  };
}

/** Anything that is not an `rw_` API key is treated as a Keycloak access token. */
export function keycloakAuthenticator(opts: KeycloakOptions): Authenticator {
  return async (credential) => {
    if (credential.startsWith('rw_')) return null;
    let payload: KeycloakClaims;
    try {
      ({ payload } = await jwtVerify<KeycloakClaims>(credential, opts.keys, {
        issuer: opts.issuer,
        audience: opts.audience,
        algorithms: ['RS256'],
        clockTolerance: 5,
      }));
    } catch (err) {
      // Keycloak unreachable or slow is our problem, not a bad token: say so instead of a 401.
      if (err instanceof errors.JWKSTimeout || !(err instanceof errors.JOSEError)) {
        throw new HttpProblem(503, 'The sign-in service is not reachable. Try again shortly.');
      }
      throw new InvalidCredentials(describe(err));
    }
    if (!payload.sub) throw new InvalidCredentials('token has no subject');
    const user: UserPrincipal = {
      kind: 'user',
      id: payload.sub,
      username: payload.preferred_username ?? payload.sub,
      email: payload.email ?? null,
      name: payload.name ?? null,
      isAdmin: payload.realm_access?.roles?.includes('admin') ?? false,
    };
    return user;
  };
}

/** A short reason for the log. Clients only ever see "invalid or expired token". */
function describe(err: unknown): string {
  if (err instanceof errors.JWTExpired) return 'token expired';
  if (err instanceof errors.JWTClaimValidationFailed) return `claim "${err.claim}" failed: ${err.reason}`;
  if (err instanceof errors.JWSSignatureVerificationFailed) return 'bad signature';
  if (err instanceof errors.JWKSNoMatchingKey) return 'signed with an unknown key';
  if (err instanceof errors.JOSEError) return err.code;
  return err instanceof Error ? err.message : String(err);
}
