import type { Workspace } from '@rag/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDeleteWorkspace } from '@/workspaces/member-queries';
import { deleteErrorMessage, deleteIsConfirmed } from '@/workspaces/members';

/** `DELETE /v1/workspaces/{slug}`, behind the slug typed out: nothing here can be undone. */
export function DeleteWorkspaceDialog({
  workspace,
  onOpenChange,
}: {
  workspace: Workspace;
  onOpenChange(open: boolean): void;
}) {
  const [typed, setTyped] = useState('');
  const navigate = useNavigate();
  const remove = useDeleteWorkspace(workspace.slug);
  const confirmed = deleteIsConfirmed(typed, workspace.slug);

  return (
    <Dialog open onOpenChange={(next) => !remove.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogTitle>Delete "{workspace.name}"?</DialogTitle>
        <DialogDescription>
          This permanently deletes its documents and uploaded files, its Chroma collection, its conversations
          and its usage history. An API key that could reach only this workspace is revoked with it. It can't
          be undone.
        </DialogDescription>

        <Field
          id="delete-confirm"
          label={`Type ${workspace.slug} to confirm`}
          hint="Exactly as shown; a slug is always lower case."
        >
          <Input
            id="delete-confirm"
            aria-describedby="delete-confirm-note"
            autoComplete="off"
            className="font-mono text-[13px]"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>

        {remove.error && (
          <p role="alert" className="text-destructive text-sm">
            {deleteErrorMessage(remove.error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={!confirmed || remove.isPending}
            onClick={() =>
              remove.mutate(undefined, {
                // `replace`, so Back does not return to a workspace that no longer exists.
                // The remembered "last used" slug needs no clearing: `landingPath` already ignores
                // a slug that is not in the list any more.
                onSuccess: () => void navigate('/workspaces', { replace: true }),
              })
            }
          >
            {remove.isPending ? 'Deleting…' : 'Delete workspace'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
