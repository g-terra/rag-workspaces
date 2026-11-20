import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('drops falsy values and lets a later Tailwind class win', () => {
    const hidden = false;
    expect(cn('px-2 text-sm', hidden && 'hidden', 'px-4')).toBe('text-sm px-4');
  });
});
