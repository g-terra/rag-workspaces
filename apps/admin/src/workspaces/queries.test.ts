import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { isMissingWorkspace, shouldRetry } from './queries';

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

describe('isMissingWorkspace', () => {
  it('is true for a 404 (no such workspace, or no access)', () => {
    expect(isMissingWorkspace(new ApiError(404, 'Not found'))).toBe(true);
  });

  it('is true for a 400, which the API sends for a slug that cannot exist (e.g. /w/NOPE)', () => {
    expect(isMissingWorkspace(new ApiError(400, 'The request did not match the schema.'))).toBe(true);
  });

  it('is false for a server error, which is worth retrying', () => {
    expect(isMissingWorkspace(new ApiError(503, 'Unavailable'))).toBe(false);
    expect(isMissingWorkspace(new TypeError('Failed to fetch'))).toBe(false);
  });
});
