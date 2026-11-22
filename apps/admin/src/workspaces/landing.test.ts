import { afterEach, describe, expect, it, vi } from 'vitest';
import { landingPath, readLastSlug, rememberSlug } from './landing';

describe('landingPath', () => {
  it('opens the last used workspace if it still exists', () => {
    expect(landingPath(['ouc', 'personal'], 'personal')).toBe('/w/personal');
  });

  it('falls back to the first workspace when the last one is gone or unknown', () => {
    expect(landingPath(['ouc', 'personal'], 'deleted')).toBe('/w/ouc');
    expect(landingPath(['ouc'], null)).toBe('/w/ouc');
  });

  it('goes to the workspace list when there are none', () => {
    expect(landingPath([], 'ouc')).toBe('/workspaces');
  });
});

describe('last workspace storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('remembers and reads back the slug', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    rememberSlug('ouc');
    expect(readLastSlug()).toBe('ouc');
  });

  it('treats blocked or missing storage as nothing remembered', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked });
    expect(() => rememberSlug('ouc')).not.toThrow();
    expect(readLastSlug()).toBeNull();
  });
});
