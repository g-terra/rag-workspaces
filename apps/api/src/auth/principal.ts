/** Who is calling. Set on every request by the auth plugin; `null` when no credentials were sent. */
export type Principal = UserPrincipal | KeyPrincipal;

/** A person signed in through Keycloak. `id` is their Keycloak user id (the token's `sub`). */
export type UserPrincipal = {
  kind: 'user';
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  /** Holds the realm role `admin`: manages everything. */
  isAdmin: boolean;
};

/** An `rw_` API key: one role, bound to a set of workspaces. */
export type KeyPrincipal = {
  kind: 'key';
  id: string;
  name: string;
  role: 'reader' | 'editor';
  workspaces: { id: string; slug: string }[];
};

/**
 * Turns a bearer credential into a principal. Returns `null` when the credential is not
 * this authenticator's kind, and throws `InvalidCredentials` when it is but does not check out.
 */
export type Authenticator = (credential: string) => Promise<Principal | null>;

export class InvalidCredentials extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidCredentials';
  }
}
