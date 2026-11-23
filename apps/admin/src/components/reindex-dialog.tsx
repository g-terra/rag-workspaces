import type { ReindexWorkspace, SystemStatus, Workspace } from '@rag/shared';
import { useState } from 'react';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { embeddingChoices, hostedWarning, reindexErrorMessage } from '@/workspaces/settings';
import { useReindexWorkspace } from '@/workspaces/queries';

const selectClass =
  'border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-2.5 text-sm shadow-xs';

/** The value of "keep the model it has": the one option that sends no model at all. */
const KEEP = '';

/**
 * `POST /v1/workspaces/{slug}/reindex`. Two jobs in one dialog, because the API is one route: run
 * every document through ingestion again with the settings it has now, or switch the workspace to
 * another embedding model, which a reindex is the only way to do.
 */
export function ReindexDialog({
  workspace,
  system,
  onOpenChange,
}: {
  workspace: Workspace;
  system?: SystemStatus;
  onOpenChange(open: boolean): void;
}) {
  const [choice, setChoice] = useState(KEEP);
  const reindex = useReindexWorkspace(workspace.slug);
  const current = `${workspace.settings.embeddingProvider} / ${workspace.settings.embeddingModel}`;
  // Only the models the API could actually embed with: configured, answering, and able to embed.
  const options = embeddingChoices(system).filter(
    (c) =>
      !(c.provider === workspace.settings.embeddingProvider && c.model === workspace.settings.embeddingModel),
  );
  const picked = options.find((c) => `${c.provider}/${c.model}` === choice);
  const warning = picked ? hostedWarning(picked.provider) : null;

  const body: ReindexWorkspace = picked
    ? { embeddingProvider: picked.provider, embeddingModel: picked.model }
    : {};

  return (
    <Dialog open onOpenChange={(next) => !reindex.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogTitle>Reindex "{workspace.name}"?</DialogTitle>
        <DialogDescription>
          Every document goes through the ingest flow again with this workspace's current settings. Asking,
          chatting and search are paused for this workspace until the last document finishes.
        </DialogDescription>

        <Field
          id="reindex-model"
          label="Embedding model"
          hint={
            options.length === 0
              ? `Keeping ${current}. No other model is available right now.`
              : 'Changing it is the only reason the vectors must be built from nothing; a reindex with the same model just redoes the chunking.'
          }
        >
          <select
            id="reindex-model"
            aria-describedby="reindex-model-note"
            className={selectClass}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            disabled={options.length === 0}
          >
            <option value={KEEP}>Keep {current}</option>
            {options.map((c) => (
              <option key={`${c.provider}/${c.model}`} value={`${c.provider}/${c.model}`}>
                {c.provider} / {c.model}
              </option>
            ))}
          </select>
        </Field>

        {warning && (
          <p className="text-muted-foreground text-xs" role="status">
            {warning}
          </p>
        )}
        {reindex.error && (
          <p role="alert" className="text-destructive text-sm">
            {reindexErrorMessage(reindex.error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            disabled={reindex.isPending}
            onClick={() => reindex.mutate(body, { onSuccess: () => onOpenChange(false) })}
          >
            {reindex.isPending ? 'Starting…' : 'Reindex workspace'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
