import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** A sealed value that can't be opened: another `SECRETS_KEY`, another row, or tampered with. */
export class SecretUnreadable extends Error {}

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The AES-256 key, derived from `SECRETS_KEY` so any long random string will do. */
function aesKey(secretsKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secretsKey, '', 'rag-workspaces provider keys v1', 32));
}

/**
 * Encrypts a provider API key with AES-256-GCM. `context` (workspace id and provider) is bound as
 * additional data, so a sealed key copied to another row won't open there. The result is
 * `v1.<base64url(iv | tag | ciphertext)>`.
 */
export function sealSecret(secretsKey: string, plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', aesKey(secretsKey), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
}

/** The inverse of `sealSecret`; throws `SecretUnreadable` rather than return a wrong value. */
export function openSecret(secretsKey: string, sealed: string, context: string): string {
  const [version, data] = sealed.split('.');
  const raw = Buffer.from(data ?? '', 'base64url');
  if (version !== VERSION || raw.length <= IV_BYTES + TAG_BYTES) throw new SecretUnreadable('malformed');
  try {
    const decipher = createDecipheriv('aes-256-gcm', aesKey(secretsKey), raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new SecretUnreadable('does not open with this SECRETS_KEY');
  }
}
