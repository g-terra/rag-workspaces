import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { shouldRetry } from './queries';

describe('shouldRetry', () => {
  it('never retries a 4xx, so "not found" shows at once', () => {
    expect(shouldRetry(0, new ApiError(404, 'Not Found'))).toBe(false);
    expect(shouldRetry(0, new ApiError(403, 'Forbidden'))).toBe(false);
  });

  it('retries network and server errors twice', () => {
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, 'Service Unavailable'))).toBe(true);
    expect(shouldRetry(2, new ApiError(503, 'Service Unavailable'))).toBe(false);
  });
});
