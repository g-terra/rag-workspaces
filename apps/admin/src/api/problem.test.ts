import { describe, expect, it } from 'vitest';
import { failureDetail, problemDetail } from './problem';

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

describe('problemDetail', () => {
  it("reads the response's problem JSON", async () => {
    const res = new Response(JSON.stringify({ detail: 'Langflow is still starting. Try again shortly.' }), {
      status: 503,
    });
    expect(await problemDetail(res)).toBe('Langflow is still starting. Try again shortly.');
  });

  it('falls back to the status when the body is not JSON', async () => {
    expect(await problemDetail(new Response('<html>502</html>', { status: 502 }))).toBe('HTTP 502');
  });
});
