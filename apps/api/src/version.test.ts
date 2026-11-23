import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version.js';

describe('VERSION', () => {
  it('is the released version that release-please keeps in its manifest', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../.release-please-manifest.json', import.meta.url), 'utf8'),
    ) as Record<string, string>;
    expect(VERSION).toBe(manifest['.']);
  });
});
