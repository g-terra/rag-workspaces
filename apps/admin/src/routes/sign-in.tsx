import { Layers, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { safeReturnTo } from '@/auth/return-to';
import { Button } from '@/components/ui/button';

/** The approved "Sign in" mock: a short pitch on the left, one button that goes to Keycloak on the right. */
export function SignIn() {
  const { user, signIn } = useAuth();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'), window.location.origin);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (user) return <Navigate to={returnTo} replace />;

  // The library fetches Keycloak's discovery document before redirecting, so a Keycloak that is down
  // fails here, on our page, instead of in the browser's address bar.
  const start = () => {
    setPending(true);
    setError(null);
    signIn(returnTo).catch(() => {
      setPending(false);
      setError("Couldn't reach the sign-in service (Keycloak). Try again in a moment.");
    });
  };

  return (
    <div className="flex min-h-screen flex-wrap">
      <div className="flex min-h-80 flex-[1_1_420px] flex-col justify-between gap-12 bg-zinc-900 p-12 text-zinc-50">
        <div className="flex items-center gap-2.5 font-semibold">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-zinc-50 text-zinc-900">
            <Layers className="size-4" />
          </span>
          rag-workspaces
        </div>
        <div className="max-w-md">
          <p className="mb-4 text-3xl leading-tight font-semibold tracking-tight">
            Ask your own material. Every answer cites its source.
          </p>
          <p className="leading-relaxed text-zinc-400">
            Isolated workspaces for course material, notes and anything else, served through one API to
            people, agents and Langflow.
          </p>
        </div>
        <p className="text-sm text-zinc-400">Admin console</p>
      </div>
      <div className="flex flex-[999_1_480px] items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-90 flex-col gap-6">
          <div>
            <h1 className="mb-2 text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-muted-foreground text-sm leading-normal">
              You'll continue to the organisation's Keycloak sign-in page, then come back here.
            </p>
          </div>
          <Button size="lg" className="w-full" disabled={pending} onClick={start}>
            <ShieldCheck /> Continue with Keycloak
          </Button>
          {error && (
            <p role="alert" className="bg-destructive/10 text-destructive rounded-lg px-3.5 py-3 text-sm">
              {error}
            </p>
          )}
          <div className="bg-muted text-muted-foreground rounded-lg border px-3.5 py-3 text-sm leading-normal">
            No account? Accounts are created by an administrator. There is no self sign-up.
          </div>
        </div>
      </div>
    </div>
  );
}
