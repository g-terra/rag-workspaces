import type { User } from '@rag/shared';
import { HttpProblem } from '../errors.js';

export type DirectoryOptions = {
  /** Keycloak inside the compose network (KEYCLOAK_INTERNAL_URL). */
  baseUrl: string;
  realm: string;
  /** The confidential `api-directory` client in docker/keycloak/realm.json. */
  clientId: string;
  /** Its secret (KEYCLOAK_DIRECTORY_SECRET). Without one the people list answers 503. */
  secret: string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  /** Per call to Keycloak. */
  timeoutMs?: number;
};

type KeycloakUser = {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
};

/** How many role lookups run at once: Keycloak lists a person's roles one person at a time. */
const ROLE_LOOKUPS_AT_ONCE = 8;

/**
 * The people in the realm, read through Keycloak's admin API as the `api-directory` service
 * account. That account holds only `realm-management: view-users`, so it can list people and
 * their roles but not change anything. Accounts are still created in Keycloak's console
 * (decision 12); this exists so an admin can grant access before someone's first sign-in.
 */
export class KeycloakDirectory {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private token?: { value: string; expiresAt: number };

  constructor(private readonly opts: DirectoryOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.now = opts.now ?? Date.now;
  }

  async list(query: { search?: string; limit: number; cursor?: string }) {
    const first = Number(query.cursor ?? 0);
    const params = new URLSearchParams({
      first: String(first),
      // One more than asked for: if it comes back, there is a next page.
      max: String(query.limit + 1),
      briefRepresentation: 'true',
    });
    if (query.search) params.set('search', query.search);
    const found = (await this.admin(`/users?${params}`)) as KeycloakUser[];
    const people = found.slice(0, query.limit);
    const admins = await this.adminIds(people.map((p) => p.id));
    return {
      data: people.map((p): User => ({
        id: p.id,
        username: p.username,
        email: p.email ?? null,
        name: [p.firstName, p.lastName].filter(Boolean).join(' ') || null,
        isAdmin: admins.has(p.id),
        enabled: p.enabled ?? true,
      })),
      nextCursor: found.length > query.limit ? String(first + query.limit) : null,
    };
  }

  /** Which of these people hold the realm role `admin`, directly or through a composite role. */
  private async adminIds(ids: string[]): Promise<Set<string>> {
    const admins = new Set<string>();
    for (let i = 0; i < ids.length; i += ROLE_LOOKUPS_AT_ONCE) {
      await Promise.all(
        ids.slice(i, i + ROLE_LOOKUPS_AT_ONCE).map(async (id) => {
          const roles = (await this.admin(
            `/users/${encodeURIComponent(id)}/role-mappings/realm/composite`,
          )) as { name: string }[];
          if (roles.some((r) => r.name === 'admin')) admins.add(id);
        }),
      );
    }
    return admins;
  }

  private async admin(path: string): Promise<unknown> {
    const url = `${this.base()}/admin/realms/${encodeURIComponent(this.opts.realm)}${path}`;
    const res = await this.call(url, { headers: { authorization: `Bearer ${await this.accessToken()}` } });
    if (!res.ok) {
      throw new HttpProblem(
        503,
        `Keycloak refused to list people (HTTP ${res.status}). Check that the ${this.opts.clientId} ` +
          'client still has the view-users role.',
      );
    }
    return res.json();
  }

  /** A service-account token (client credentials), reused until 30 s before it expires. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    if (!this.opts.secret) {
      throw new HttpProblem(
        503,
        'The people list is not set up: KEYCLOAK_DIRECTORY_SECRET is missing. Run `pnpm env:init` and restart.',
      );
    }
    const res = await this.call(
      `${this.base()}/realms/${encodeURIComponent(this.opts.realm)}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.opts.clientId,
          client_secret: this.opts.secret,
        }).toString(),
      },
    );
    if (!res.ok) {
      throw new HttpProblem(
        503,
        `Keycloak did not accept the ${this.opts.clientId} client (HTTP ${res.status}). A realm created ` +
          'before the people list needs that client: see "Updating an existing install" in the README.',
      );
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in - 30) * 1000 };
    return body.access_token;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000) });
    } catch {
      throw new HttpProblem(503, 'The sign-in service is not reachable. Try again shortly.');
    }
  }

  private base() {
    return this.opts.baseUrl.replace(/\/+$/, '');
  }
}
