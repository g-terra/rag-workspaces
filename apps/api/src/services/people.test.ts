import { describe, expect, it } from 'vitest';
import { HttpProblem } from '../errors.js';
import { KeycloakDirectory } from './people.js';

const KC = 'http://keycloak:8080';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const alice = {
  id: 'u-alice',
  username: 'alice',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Example',
  enabled: true,
};
const bob = { id: 'u-bob', username: 'bob', enabled: false };

/** A fake Keycloak: token endpoint, user list, and each user's realm roles. */
function fakeKeycloak(opts: { users?: object[]; badSecret?: boolean; down?: boolean } = {}) {
  const calls: string[] = [];
  let tokens = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (opts.down) throw new TypeError('fetch failed');
    const url = new URL(String(input));
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === '/realms/rag-workspaces/protocol/openid-connect/token') {
      const form = new URLSearchParams(String(init?.body));
      if (opts.badSecret || form.get('client_secret') !== 's3cret') {
        return json({ error: 'unauthorized_client' }, 401);
      }
      tokens += 1;
      return json({ access_token: `tok-${tokens}`, expires_in: 300 });
    }
    const auth = new Headers(init?.headers).get('authorization');
    if (!auth?.startsWith('Bearer tok-')) return json({ error: 'HTTP 401 Unauthorized' }, 401);
    if (url.pathname === '/admin/realms/rag-workspaces/users') {
      const users = opts.users ?? [alice, bob];
      const first = Number(url.searchParams.get('first') ?? 0);
      const max = Number(url.searchParams.get('max') ?? 100);
      return json(users.slice(first, first + max));
    }
    const roles = /^\/admin\/realms\/rag-workspaces\/users\/([^/]+)\/role-mappings\/realm\/composite$/.exec(
      url.pathname,
    );
    if (roles) {
      return json(roles[1] === 'u-alice' ? [{ name: 'admin' }, { name: 'offline_access' }] : []);
    }
    return json({}, 404);
  }) as typeof fetch;
  return { fetchFn, calls, tokens: () => tokens };
}

const directory = (kc: ReturnType<typeof fakeKeycloak>, opts: { secret?: string } = { secret: 's3cret' }) =>
  new KeycloakDirectory({
    baseUrl: KC,
    realm: 'rag-workspaces',
    clientId: 'api-directory',
    secret: opts.secret,
    fetch: kc.fetchFn,
  });

describe('KeycloakDirectory', () => {
  it('lists people with their admin role, names joined, missing fields as null', async () => {
    const kc = fakeKeycloak();
    const res = await directory(kc).list({ limit: 50 });
    expect(res).toEqual({
      data: [
        {
          id: 'u-alice',
          username: 'alice',
          email: 'alice@example.com',
          name: 'Alice Example',
          isAdmin: true,
          enabled: true,
        },
        { id: 'u-bob', username: 'bob', email: null, name: null, isAdmin: false, enabled: false },
      ],
      nextCursor: null,
    });
  });

  it('pages with an offset cursor, asking Keycloak for one more to know if there is a next page', async () => {
    const users = Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, username: `user${i}`, enabled: true }));
    const kc = fakeKeycloak({ users });
    const d = directory(kc);
    const first = await d.list({ limit: 2 });
    expect(first.data.map((u) => u.username)).toEqual(['user0', 'user1']);
    expect(first.nextCursor).toBe('2');
    const last = await d.list({ limit: 2, cursor: '4' });
    expect(last.data.map((u) => u.username)).toEqual(['user4']);
    expect(last.nextCursor).toBeNull();
    expect(kc.calls).toContain(
      'GET /admin/realms/rag-workspaces/users?first=0&max=3&briefRepresentation=true',
    );
  });

  it("passes the search to Keycloak's own user search", async () => {
    const kc = fakeKeycloak();
    await directory(kc).list({ limit: 10, search: 'ali ce' });
    expect(kc.calls).toContain(
      'GET /admin/realms/rag-workspaces/users?first=0&max=11&briefRepresentation=true&search=ali+ce',
    );
  });

  it('reuses its service-account token until it is about to expire', async () => {
    const kc = fakeKeycloak();
    const d = directory(kc);
    await d.list({ limit: 50 });
    await d.list({ limit: 50 });
    expect(kc.tokens()).toBe(1);
  });

  it('503 with a setup hint when the secret is not configured', async () => {
    const kc = fakeKeycloak();
    const err = await directory(kc, {})
      .list({ limit: 50 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpProblem);
    expect(err).toMatchObject({ status: 503 });
    expect((err as HttpProblem).message).toMatch(/KEYCLOAK_DIRECTORY_SECRET/);
    expect(kc.calls).toEqual([]);
  });

  it('503 naming the client when Keycloak refuses the secret (for example an older realm)', async () => {
    const err = await directory(fakeKeycloak({ badSecret: true }))
      .list({ limit: 50 })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 503 });
    expect((err as HttpProblem).message).toMatch(/api-directory/);
  });

  it('503 when Keycloak cannot be reached', async () => {
    const err = await directory(fakeKeycloak({ down: true }))
      .list({ limit: 50 })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 503 });
  });
});
