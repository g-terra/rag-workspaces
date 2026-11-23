import { BarChart3, FileText, Upload } from 'lucide-react';
import { NavLink, useMatch } from 'react-router';
import { navItemClass } from '@/lib/utils';
import { useWorkspaces } from '@/workspaces/queries';

/** The sidebar's "Workspace" section: the screens of the open workspace that the caller's access allows. */
export function WorkspaceNav() {
  const slug = useMatch('/w/:slug/*')?.params.slug;
  const workspace = useWorkspaces().data?.find((w) => w.slug === slug);
  if (!workspace) return null;
  const base = `/w/${workspace.slug}`;
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-0.5">
      <p className="text-muted-foreground mb-1 px-2.5 text-xs font-medium">Workspace</p>
      {workspace.access !== 'reader' && (
        <NavLink to={`${base}/upload`} className={navItemClass}>
          <Upload className="size-4" /> Upload
        </NavLink>
      )}
      <NavLink to={`${base}/documents`} className={navItemClass}>
        <FileText className="size-4" /> Documents
      </NavLink>
      {workspace.access !== 'reader' && (
        <NavLink to={`${base}/usage`} className={navItemClass}>
          <BarChart3 className="size-4" /> Usage
        </NavLink>
      )}
    </nav>
  );
}
