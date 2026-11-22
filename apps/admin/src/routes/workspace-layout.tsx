import { useEffect } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { ErrorState, Loading, Notice } from '@/components/states';
import { Button } from '@/components/ui/button';
import { rememberSlug } from '@/workspaces/landing';
import { isMissingWorkspace, useWorkspace } from '@/workspaces/queries';

/** `/w/:slug`: loads the workspace once for every screen inside it, and remembers it as the last used. */
export function WorkspaceLayout() {
  const slug = useParams().slug!;
  const workspace = useWorkspace(slug);
  const found = workspace.isSuccess;

  useEffect(() => {
    if (found) rememberSlug(slug);
  }, [found, slug]);

  if (workspace.isPending) return <Loading what="the workspace" />;
  if (workspace.isError) {
    const notFound = isMissingWorkspace(workspace.error);
    return (
      <div className="px-6 py-7">
        {notFound ? (
          <Notice
            title="Workspace not found"
            body={`There is no workspace "${slug}", or you don't have access to it.`}
            alert
          >
            <Button variant="outline" size="sm" asChild>
              <Link to="/workspaces">See all workspaces</Link>
            </Button>
          </Notice>
        ) : (
          <ErrorState
            title="Couldn't load the workspace"
            error={workspace.error}
            onRetry={() => void workspace.refetch()}
          />
        )}
      </div>
    );
  }
  return <Outlet context={workspace.data} />;
}
