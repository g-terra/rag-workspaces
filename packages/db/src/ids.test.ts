import { describe, expect, it } from 'vitest';
import { newId, ulid } from './ids.js';

describe('ids', () => {
  it('encodes time and randomness as a 26-character Crockford ULID', () => {
    const id = ulid(1_469_918_176_385, new Uint8Array(10));
    // Reference value for this timestamp from the ULID spec, with all-zero randomness.
    expect(id).toBe('01ARYZ6S41' + '0'.repeat(16));
  });

  it('prefixes ids by kind', () => {
    expect(newId('workspace')).toMatch(/^ws_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(newId('apiKey')).toMatch(/^key_/);
  });

  it('sorts by creation time', () => {
    const a = newId('document', 1_000);
    const b = newId('document', 2_000);
    expect(a < b).toBe(true);
  });
});
