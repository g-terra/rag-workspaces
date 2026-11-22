import { describe, expect, it } from 'vitest';
import { failureDetail } from './upload';

describe('failureDetail', () => {
  it("prefers the problem's detail, then its title", () => {
    expect(failureDetail({ detail: 'Bad file', title: 'Bad Request' }, 400, 'Bad Request')).toBe('Bad file');
    expect(failureDetail({ title: 'Conflict' }, 409, '')).toBe('Conflict');
  });

  it('falls back to the status text, then to the status code', () => {
    expect(failureDetail(null, 502, 'Bad Gateway')).toBe('Bad Gateway');
    expect(failureDetail(null, 502, '')).toBe('HTTP 502');
  });
});
