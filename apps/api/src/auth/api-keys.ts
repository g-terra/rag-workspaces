import { createHash, randomBytes } from 'node:crypto';
import { apiKeys, apiKeyWorkspaces, workspaces, type Database } from '@rag/db';
import { eq } from 'drizzle-orm';
import { InvalidCredentials, type Authenticator, type KeyPrincipal } from './principal.js';

const API_KEY_PREFIX = 'rw_';
/** How much of the secret is kept in clear for display (`rw_7Hk2`). */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 4;
/** Don't write `last_used_at` more often than this per key. */
const LAST_USED_RESOLUTION_MS = 60_000;

/** A new secret: `rw_` + 32 random bytes in base64url (43 characters). */
export function generateSecret(): { secret: string; prefix: string; hash: string } {
  const secret = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { secret, prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH), hash: hashSecret(secret) };
}

/**
 * SHA-256, not bcrypt or argon2: the secret is 256 random bits, so it cannot be guessed
 * from its hash, and a fast hash lets every request look the key up by index.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function apiKeyAuthenticator(db: Database, now: () => Date = () => new Date()): Authenticator {
  return async (credential) => {
    if (!credential.startsWith(API_KEY_PREFIX)) return null;
    const rows = await db
      .select({ key: apiKeys, workspaceId: workspaces.id, slug: workspaces.slug })
      .from(apiKeys)
      .leftJoin(apiKeyWorkspaces, eq(apiKeyWorkspaces.apiKeyId, apiKeys.id))
      .leftJoin(workspaces, eq(workspaces.id, apiKeyWorkspaces.workspaceId))
      .where(eq(apiKeys.secretHash, hashSecret(credential)));
    const key = rows[0]?.key;
    if (!key) throw new InvalidCredentials('unknown API key');
    const at = now();
    if (key.revokedAt) throw new InvalidCredentials(`API key ${key.id} is revoked`);
    if (key.expiresAt && key.expiresAt <= at) throw new InvalidCredentials(`API key ${key.id} expired`);

    if (!key.lastUsedAt || at.getTime() - key.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      // Fire and forget: a failed bookkeeping write must not fail the request.
      void db
        .update(apiKeys)
        .set({ lastUsedAt: at })
        .where(eq(apiKeys.id, key.id))
        .catch(() => {});
    }

    const principal: KeyPrincipal = {
      kind: 'key',
      id: key.id,
      name: key.name,
      role: key.role,
      workspaces: rows.flatMap((r) => (r.workspaceId && r.slug ? [{ id: r.workspaceId, slug: r.slug }] : [])),
    };
    return principal;
  };
}
