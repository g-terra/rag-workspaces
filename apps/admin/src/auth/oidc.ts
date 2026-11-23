import { UserManager } from 'oidc-client-ts';

/** Keycloak as the browser sees it. Baked in at build time; see docker/admin.Dockerfile. */
export const KEYCLOAK_URL: string = import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8081';

/**
 * The `admin-ui` client in docker/keycloak/realm.json: public, authorization code with PKCE (S256).
 * `oidc-client-ts` makes the PKCE verifier, swaps the code for tokens, keeps them in sessionStorage
 * and renews the access token with the refresh token a minute before it expires.
 */
export const userManager = new UserManager({
  authority: `${KEYCLOAK_URL}/realms/rag-workspaces`,
  client_id: 'admin-ui',
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  scope: 'openid profile email',
  automaticSilentRenew: true,
});

/** The state carried through Keycloak and back: where to go after signing in. */
export interface SignInState {
  returnTo: string;
}
