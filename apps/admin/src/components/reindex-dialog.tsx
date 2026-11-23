import type { EmbeddingProvider, ReindexWorkspace, SystemStatus, Workspace } from '@rag/shared';
import { useState } from 'react';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useReindexWorkspace } from '@/workspaces/queries';
import {
  embeddingProviderChoices,
  hostedEmbeddingWarning,
  providerModels,
  reindexErrorMessage,
} from '@/workspaces/settings';

const selectClass =
  'border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-2.5 text-sm shadow-xs';

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
  const pinned = workspace.settings;
  const [provider, setProvider] = useState<EmbeddingProvider>(pinned.embeddingProvider);
  const [model, setModel] = useState(pinned.embeddingModel);
  const reindex = useReindexWorkspace(workspace.slug);

  const changed = provider !== pinned.embeddingProvider || model.trim() !== pinned.embeddingModel;
  const warning = changed ? hostedEmbeddingWarning(provider) : null;
  // The API wants a provider and a model together, so a change sends both even when only one moved.
  const body: ReindexWorkspace = changed ? { embeddingProvider: provider, embeddingModel: model.trim() } : {};
  // The provider's own catalogue, as suggestions only: `GET /v1/models` does not say which of them
  // embed, so the field stays typeable and the hint says what the list is.
  const suggestions = providerModels(system, provider);

  return (
    <Dialog open onOpenChange={(next) => !reindex.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogTitle>Reindex "{workspace.name}"?</DialogTitle>
        <DialogDescription>
          Every document goes through the ingest flow again with this workspace's current settings. Asking,
          chatting and search are paused for this workspace until the last document finishes.
        </DialogDescription>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            id="reindex-provider"
            label="Embedding provider"
            hint={system ? undefined : "The model providers couldn't be read, so all of them are offered."}
          >
            <select
              id="reindex-provider"
              aria-describedby="reindex-provider-note"
              className={selectClass}
              value={provider}
              onChange={(e) => setProvider(e.target.value as EmbeddingProvider)}
            >
              {embeddingProviderChoices(system, pinned.embeddingProvider).map((id) => (
                <option key={id} value={id}>
                  {id}
                  {id === pinned.embeddingProvider ? ' (in use)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="reindex-model"
            label="Embedding model"
            error={changed && model.trim() === '' ? 'Name the model to embed with.' : undefined}
            hint={
              suggestions.length > 0
                ? 'Suggestions are everything this provider serves, embedding or not — a chat model here fails every document.'
                : 'The model id, as the provider names it.'
            }
          >
            <Input
              id="reindex-model"
              list={suggestions.length > 0 ? 'reindex-model-options' : undefined}
              aria-describedby="reindex-model-note"
              aria-invalid={changed && model.trim() === ''}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            {suggestions.length > 0 && (
              <datalist id="reindex-model-options">
                {suggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            )}
          </Field>
        </div>

        {changed ? (
          <p className="text-muted-foreground text-xs" role="status">
            Changing the model is the only reason the vectors must be built from nothing; a reindex with the
            model it has just redoes the chunking.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs" role="status">
            Keeping the model it has, so this redoes the chunking with the workspace's current settings.
          </p>
        )}
        {warning && (
          <p
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
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
            disabled={reindex.isPending || (changed && model.trim() === '')}
            onClick={() => reindex.mutate(body, { onSuccess: () => onOpenChange(false) })}
          >
            {reindex.isPending ? 'Starting…' : 'Reindex workspace'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
