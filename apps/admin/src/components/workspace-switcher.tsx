import { ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useMatch } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { CreateWorkspaceDialog } from '@/components/create-workspace-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WorkspaceAvatar } from '@/components/workspace-avatar';
import { useWorkspaces } from '@/workspaces/queries';

const row = 'hover:bg-accent flex w-full items-center gap-2.5 rounded-md p-2 text-left text-[13px]';

/** The sidebar button with the current workspace; its popover switches to another or creates one. */
export function WorkspaceSwitcher() {
  const { me } = useAuth();
  const slug = useMatch('/w/:slug/*')?.params.slug;
  const workspaces = useWorkspaces();
  const current = workspaces.data?.find((w) => w.slug === slug);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Switch workspace"
        className="bg-card hover:bg-accent flex w-full items-center gap-2.5 rounded-lg border p-2 text-left"
      >
        {current ? (
          <WorkspaceAvatar name={current.name} slug={current.slug} />
        ) : (
          <span className="bg-muted size-7 flex-none rounded-md" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold" data-testid="current-workspace">
            {current?.name ?? 'Choose a workspace'}
          </span>
          {current && <span className="text-muted-foreground block font-mono text-xs">{current.slug}</span>}
        </span>
        <ChevronsUpDown className="text-muted-foreground size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-1.5">
        <p className="text-muted-foreground px-2 pt-1.5 pb-1 text-xs font-medium">Switch workspace</p>
        {workspaces.isPending && <p className="text-muted-foreground p-2 text-[13px]">Loading…</p>}
        {workspaces.isError && (
          <p className="text-destructive p-2 text-[13px]">
            Couldn't load workspaces: {workspaces.error.message}
          </p>
        )}
        {workspaces.data?.length === 0 && (
          <p className="text-muted-foreground p-2 text-[13px]">No workspaces yet.</p>
        )}
        {workspaces.data?.map((w) => (
          <Link key={w.slug} to={`/w/${w.slug}`} className={row} onClick={() => setOpen(false)}>
            <WorkspaceAvatar name={w.name} slug={w.slug} />
            <span className="flex-1 truncate">{w.name}</span>
            <span className="text-muted-foreground font-mono text-xs">{w.slug}</span>
          </Link>
        ))}
        <div className="my-1 border-t" />
        <Link to="/workspaces" className={row} onClick={() => setOpen(false)}>
          <LayoutGrid className="size-4" /> All workspaces
        </Link>
        {me?.isAdmin && (
          <button
            type="button"
            className={row}
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            <Plus className="size-4" /> Create workspace
            <span className="text-muted-foreground ml-auto text-[11px]">admin</span>
          </button>
        )}
      </PopoverContent>
      {/* The dialog renders in its own portal, so it can sit inside the popover root. */}
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </Popover>
  );
}
