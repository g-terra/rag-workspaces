import { describe, expect, it } from 'vitest';
import { hasSeenTour, markTourSeen } from './seen';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const broken: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('tour seen flag', () => {
  it('is unset for a new user and set once marked', () => {
    const s = memoryStorage();
    expect(hasSeenTour('u1', s)).toBe(false);
    markTourSeen('u1', s);
    expect(hasSeenTour('u1', s)).toBe(true);
  });

  it('is kept per user', () => {
    const s = memoryStorage();
    markTourSeen('u1', s);
    expect(hasSeenTour('u2', s)).toBe(false);
  });

  it('uses the rw.tourSeen.<sub> key', () => {
    const s = memoryStorage();
    markTourSeen('abc', s);
    expect(s.getItem('rw.tourSeen.abc')).toBe('1');
  });

  it('treats blocked storage as not seen and does not throw', () => {
    expect(hasSeenTour('u1', broken)).toBe(false);
    expect(() => markTourSeen('u1', broken)).not.toThrow();
  });
});
