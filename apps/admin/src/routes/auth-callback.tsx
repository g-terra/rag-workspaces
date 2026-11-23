import type { User } from 'oidc-client-ts';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { userManager, type SignInState } from '@/auth/oidc';
import { safeReturnTo } from '@/auth/return-to';

// The code can be swapped for tokens only once; React's development double-render must not try twice.
let pending: Promise<User> | null = null;

/** Keycloak sends the browser here with a code; swap it for tokens, then go where the person was headed. */
export function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pending ??= userManager.signinRedirectCallback();
    pending.then(
      (user) => {
        pending = null;
        const state = user.state as SignInState | undefined;
        void navigate(safeReturnTo(state?.returnTo, window.location.origin), { replace: true });
      },
      (e: unknown) => {
        pending = null;
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, [navigate]);

  if (!error) return <p className="text-muted-foreground p-8 text-sm">Signing you in…</p>;
  return (
    <div className="mx-auto max-w-md space-y-3 p-8">
      <h1 className="text-xl font-semibold">Sign-in didn't complete</h1>
      <p className="text-muted-foreground text-sm">{error}</p>
      <Link className="text-sm underline" to="/sign-in">
        Sign in again
      </Link>
    </div>
  );
}
