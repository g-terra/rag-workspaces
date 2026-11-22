import { describe, expect, it, vi } from 'vitest';
import { sendAuthorized } from './authorized';

function auth(renewed: string | null = 'fresh') {
  return {
    getToken: vi.fn(() => Promise.resolve('stale')),
    renewToken: vi.fn(() => Promise.resolve(renewed)),
    endSession: vi.fn(),
  };
}

describe('sendAuthorized', () => {
  it('sends with the current token', async () => {
    const a = auth();
    const send = vi.fn((token: string | null) => Promise.resolve({ status: 201, token }));
    expect(await sendAuthorized(a, send)).toEqual({ status: 201, token: 'stale' });
    expect(a.renewToken).not.toHaveBeenCalled();
  });

  it('renews the token once on a 401 and sends again', async () => {
    const a = auth();
    const send = vi.fn((token: string | null) => Promise.resolve({ status: token === 'fresh' ? 201 : 401 }));
    expect(await sendAuthorized(a, send)).toEqual({ status: 201 });
    expect(send.mock.calls).toEqual([['stale'], ['fresh']]);
    expect(a.endSession).not.toHaveBeenCalled();
  });

  it('ends the session when the renewed token is refused too', async () => {
    const a = auth();
    const send = vi.fn(() => Promise.resolve({ status: 401 }));
    expect(await sendAuthorized(a, send)).toEqual({ status: 401 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(a.endSession).toHaveBeenCalledOnce();
  });

  it('ends the session when the token cannot be renewed', async () => {
    const a = auth(null);
    const send = vi.fn(() => Promise.resolve({ status: 401 }));
    expect(await sendAuthorized(a, send)).toEqual({ status: 401 });
    expect(send).toHaveBeenCalledOnce();
    expect(a.endSession).toHaveBeenCalledOnce();
  });
});
