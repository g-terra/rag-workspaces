import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret, SecretUnreadable } from './secrets.js';

const KEY = 'a-long-random-secrets-key';

describe('sealSecret / openSecret', () => {
  it('round-trips, and the sealed form does not contain the plaintext', () => {
    const sealed = sealSecret(KEY, 'sk-very-secret-1234', 'w1:openai');
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('sk-very-secret');
    expect(openSecret(KEY, sealed, 'w1:openai')).toBe('sk-very-secret-1234');
  });

  it('seals the same value differently each time (fresh IV)', () => {
    expect(sealSecret(KEY, 'same', 'a')).not.toBe(sealSecret(KEY, 'same', 'a'));
  });

  it('refuses another SECRETS_KEY', () => {
    const sealed = sealSecret(KEY, 'sk-1', 'w1:openai');
    expect(() => openSecret('another-key', sealed, 'w1:openai')).toThrow(SecretUnreadable);
  });

  it('refuses a sealed value moved to another workspace or provider', () => {
    const sealed = sealSecret(KEY, 'sk-1', 'w1:openai');
    expect(() => openSecret(KEY, sealed, 'w2:openai')).toThrow(SecretUnreadable);
    expect(() => openSecret(KEY, sealed, 'w1:gemini')).toThrow(SecretUnreadable);
  });

  it('refuses a tampered or malformed value', () => {
    const sealed = sealSecret(KEY, 'sk-1', 'a');
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');
    expect(() => openSecret(KEY, tampered, 'a')).toThrow(SecretUnreadable);
    expect(() => openSecret(KEY, 'garbage', 'a')).toThrow(SecretUnreadable);
  });
});
