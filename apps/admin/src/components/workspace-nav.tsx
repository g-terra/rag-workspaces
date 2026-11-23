import { BarChart3, FileText, MessagesSquare, Settings, Sparkles, Upload } from 'lucide-react';
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
        <NavLink to={`${base}/upload`} className={navItemClass} data-tour="upload">
          <Upload className="size-4" /> Upload
        </NavLink>
      )}
      <NavLink to={`${base}/documents`} className={navItemClass} data-tour="documents">
        <FileText className="size-4" /> Documents
      </NavLink>
      <NavLink to={`${base}/playground`} className={navItemClass} data-tour="playground">
        <Sparkles className="size-4" /> Playground
      </NavLink>
      <NavLink to={`${base}/conversations`} className={navItemClass} data-tour="conversations">
        <MessagesSquare className="size-4" /> Conversations
      </NavLink>
      {workspace.access !== 'reader' && (
        <NavLink to={`${base}/usage`} className={navItemClass} data-tour="usage">
          <BarChart3 className="size-4" /> Usage
        </NavLink>
      )}
      {/* Settings, members and delete all need admin access in the API, not merely editor. */}
      {workspace.access === 'admin' && (
        <NavLink to={`${base}/settings`} className={navItemClass} data-tour="settings">
          <Settings className="size-4" /> Settings
        </NavLink>
      )}
    </nav>
  );
}
