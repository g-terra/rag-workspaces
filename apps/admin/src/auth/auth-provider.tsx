import type { Me } from '@rag/shared';
import type { User } from 'oidc-client-ts';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createApiClient } from '@/api/client';
import { AuthContext, type AuthContextValue, type MeUser } from './auth-context';
import { userManager, type SignInState } from './oidc';

const api = createApiClient({
  getToken: async () => (await userManager.getUser())?.access_token ?? null,
  // The token was refused, so the session is over: drop it and RequireAuth sends them to sign in.
  onUnauthorized: () => void userManager.removeUser(),
});

/** Reads the stored session, keeps it current as tokens renew or expire, and loads `GET /v1/me`. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // The /v1/me result, tagged with the user it belongs to, so a stale one is never shown.
  const [loaded, setLoaded] = useState<{ userId: string; me: MeUser | null; error: string | null } | null>(
    null,
  );

  useEffect(() => {
    const events = userManager.events;
    const onLoaded = (u: User) => setUser(u);
    const onUnloaded = () => setUser(null);
    // The refresh token was refused (expired or revoked): end the session.
    const onRenewError = () => void userManager.removeUser();
    events.addUserLoaded(onLoaded);
    events.addUserUnloaded(onUnloaded);
    events.addSilentRenewError(onRenewError);
    void restore().then(setUser);
    return () => {
      events.removeUserLoaded(onLoaded);
      events.removeUserUnloaded(onUnloaded);
      events.removeSilentRenewError(onRenewError);
    };
  }, []);

  const userId = user?.profile.sub;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api<Me>('/v1/me').then(
      (m) => {
        if (!cancelled) setLoaded({ userId, me: m.kind === 'user' ? m : null, error: null });
      },
      (e: unknown) => {
        if (!cancelled) setLoaded({ userId, me: null, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const current = loaded && loaded.userId === userId ? loaded : null;
  const me = current?.me ?? null;
  const meError = current?.error ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      me,
      meError,
      api,
      signIn: (returnTo) => userManager.signinRedirect({ state: { returnTo } satisfies SignInState }),
      signOut: () => userManager.signoutRedirect(),
    }),
    [user, me, meError],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

/** The stored session, renewed first if its access token has already expired. */
async function restore(): Promise<User | null> {
  const stored = await userManager.getUser();
  if (!stored) return null;
  if (!stored.expired) return stored;
  try {
    return await userManager.signinSilent();
  } catch {
    await userManager.removeUser();
    return null;
  }
}
