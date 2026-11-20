// Test helpers: a signing key that stands in for Keycloak, and a token factory.
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from 'jose';
import type { KeycloakOptions } from '../auth/keycloak.js';

export const TEST_ISSUER = 'http://localhost:8081/realms/rag-workspaces';

export async function testKeycloak() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const options: KeycloakOptions = {
    issuer: TEST_ISSUER,
    audience: 'api',
    keys: createLocalJWKSet({ keys: [jwk] }),
  };

  /** Sign a Keycloak-shaped access token. Override any claim, or the expiry. */
  async function token(claims: JWTPayload & Record<string, unknown> = {}, opts: { expiresIn?: string } = {}) {
    return new SignJWT({
      preferred_username: 'alice',
      email: 'alice@example.com',
      name: 'Alice Example',
      realm_access: { roles: ['default-roles-rag-workspaces'] },
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer((claims.iss as string) ?? TEST_ISSUER)
      .setAudience((claims.aud as string) ?? 'api')
      .setSubject((claims.sub as string) ?? '5b0d1c5e-0000-4000-8000-000000000001')
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '5m')
      .sign(privateKey);
  }

  return { options, token };
}
