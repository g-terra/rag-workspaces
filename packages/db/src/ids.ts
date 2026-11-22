import { randomBytes } from 'node:crypto';

// Prefixed ULIDs (docs/api-schema.md): `ws_01JD...`. A ULID is 48 bits of milliseconds
// and 80 random bits in Crockford base32, so ids sort by creation time and are safe in URLs.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ID_PREFIXES = {
  workspace: 'ws',
  folder: 'fld',
  document: 'doc',
  answer: 'ans',
  conversation: 'cnv',
  message: 'msg',
  apiKey: 'key',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function ulid(now = Date.now(), random: Uint8Array = randomBytes(10)): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 80 random bits -> 16 characters of 5 bits each.
  let bits = 0n;
  for (const byte of random) bits = (bits << 8n) | BigInt(byte);
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand = ALPHABET[Number(bits & 31n)] + rand;
    bits >>= 5n;
  }
  return time + rand;
}

export function newId(kind: IdKind, now?: number): string {
  return `${ID_PREFIXES[kind]}_${ulid(now)}`;
}
