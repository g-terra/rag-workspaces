import { Link } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { ErrorState, Loading, Notice } from '@/components/states';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { WorkspaceAvatar } from '@/components/workspace-avatar';
import { useWorkspaces } from '@/workspaces/queries';

/** "All workspaces": a card per workspace the caller can see. */
export function Workspaces() {
  const { me } = useAuth();
  const workspaces = useWorkspaces();
  const isAdmin = me?.isAdmin ?? false;

  return (
    <>
      <TopBar trail={isAdmin ? ['Admin', 'All workspaces'] : ['All workspaces']} />
      <div className="flex w-full max-w-290 flex-col gap-6 px-6 pt-7 pb-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">Workspaces</h1>
            <p className="text-muted-foreground text-sm">
              Each workspace has its own collection, routes, keys and analytics. Nothing is shared between
              them.
            </p>
          </div>
        </div>
        {workspaces.isPending && <Loading what="workspaces" />}
        {workspaces.isError && (
          <ErrorState
            title="Couldn't load workspaces"
            error={workspaces.error}
            onRetry={() => void workspaces.refetch()}
          />
        )}
        {workspaces.data?.length === 0 &&
          (isAdmin ? (
            <Notice
              title="No workspaces yet"
              body="Workspaces are created by an administrator, with POST /v1/workspaces for now."
            />
          ) : (
            <Notice
              title="No workspaces"
              body="You don't have access to any workspace yet. Ask an administrator."
            />
          ))}
        {!!workspaces.data?.length && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {workspaces.data.map((w) => (
              <article key={w.slug} className="bg-card flex flex-col gap-4 rounded-xl border p-5">
                <div className="flex items-start gap-3">
                  <WorkspaceAvatar name={w.name} slug={w.slug} className="size-10 text-base" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold">{w.name}</h2>
                    <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                      /v1/workspaces/{w.slug}
                    </p>
                  </div>
                </div>
                <p className="text-muted-foreground min-h-10.5 text-sm leading-normal">{w.description}</p>
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/w/${w.slug}`} aria-label={`Open ${w.name}`}>
                    Open
                  </Link>
                </Button>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
