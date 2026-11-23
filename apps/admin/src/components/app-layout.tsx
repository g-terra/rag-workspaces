import { Layers, LogOut } from 'lucide-react';
import { Outlet } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { Button } from '@/components/ui/button';

/** The sidebar from the approved mocks, with the signed-in person and sign-out at the bottom. */
export function AppLayout() {
  const { user, me, meError, signOut } = useAuth();
  const name = me?.name ?? me?.username ?? user?.profile.preferred_username ?? '…';

  return (
    <div className="flex min-h-screen flex-wrap">
      <aside className="bg-muted/40 flex flex-[1_1_240px] flex-col gap-5 border-r px-3 py-4">
        <div className="flex items-center gap-2.5 px-1 font-semibold">
          <span className="bg-primary text-primary-foreground inline-flex size-7 items-center justify-center rounded-md">
            <Layers className="size-4" />
          </span>
          rag-workspaces
        </div>
        <div className="mt-auto flex items-center gap-2.5 border-t px-1 pt-2">
          <span
            aria-hidden
            className="bg-secondary inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold"
          >
            {name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" data-testid="user-name">
              {name}
            </span>
            <span className="text-muted-foreground block text-xs" data-testid="user-role">
              {me ? (me.isAdmin ? 'admin' : 'member') : ''}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            onClick={() => {
              // The local session is dropped first, so the person is signed out here even if Keycloak
              // can't be reached to end its own session.
              signOut().catch(() => undefined);
            }}
          >
            <LogOut />
          </Button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-[999_1_560px] flex-col">
        {meError && (
          <p role="alert" className="bg-destructive/10 text-destructive border-b px-6 py-2 text-sm">
            Couldn't load your account from the API: {meError}
          </p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
