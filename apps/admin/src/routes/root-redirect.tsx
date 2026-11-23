import { Navigate } from 'react-router';
import { ErrorState, Loading } from '@/components/states';
import { landingPath, readLastSlug } from '@/workspaces/landing';
import { useWorkspaces } from '@/workspaces/queries';

/** `/`: open the last used workspace, else the first one, else the list (which explains what to do). */
export function RootRedirect() {
  const workspaces = useWorkspaces();
  if (workspaces.isPending) return <Loading what="workspaces" />;
  if (workspaces.isError) {
    return (
      <div className="px-6 py-7">
        <ErrorState
          title="Couldn't load your workspaces"
          error={workspaces.error}
          onRetry={() => void workspaces.refetch()}
        />
      </div>
    );
  }
  const slugs = workspaces.data.map((w) => w.slug);
  return <Navigate to={landingPath(slugs, readLastSlug())} replace />;
}
