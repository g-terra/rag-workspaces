import type { HostedProvider, WorkspaceProvider } from '@rag/shared';
import { useState } from 'react';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  HOSTED,
  keyNote,
  providerKeyErrorMessage,
  useRemoveProviderKey,
  useSaveProviderKey,
} from '@/workspaces/providers';

const LABEL: Record<HostedProvider, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic',
};

/**
 * One row per hosted provider: where this workspace's key comes from, and buttons to save, replace
 * or remove its own. The keys themselves never reach the browser after they are typed.
 */
export function ProviderKeys({
  slug,
  providers,
  onAdd,
}: {
  slug: string;
  providers: WorkspaceProvider[] | undefined;
  onAdd(provider: HostedProvider): void;
}) {
  const remove = useRemoveProviderKey(slug);
  return (
    <ul className="divide-y rounded-lg border">
      {HOSTED.map((id) => {
        const p = providers?.find((x) => x.id === id);
        const own = p?.key.source === 'workspace';
        return (
          <li
            key={id}
            className="flex flex-wrap items-center gap-3 px-3.5 py-2.5"
            aria-label={`${LABEL[id]} key`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{LABEL[id]}</p>
              <p className="text-muted-foreground text-xs">{p ? keyNote(p) : 'Checking…'}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onAdd(id)}>
              {own ? 'Replace key' : 'Add key'}
            </Button>
            {own && (
              <Button
                variant="ghost"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate(id)}
                aria-label={`Remove the ${LABEL[id]} key`}
              >
                Remove
              </Button>
            )}
          </li>
        );
      })}
      {remove.error && (
        <li role="alert" className="text-destructive px-3.5 py-2 text-sm">
          {providerKeyErrorMessage(remove.error)}
        </li>
      )}
    </ul>
  );
}

/** Asks for one provider's key and saves it; the API checks it with the provider first. */
export function ProviderKeyDialog({
  slug,
  provider,
  onOpenChange,
}: {
  slug: string;
  provider: HostedProvider;
  onOpenChange(open: boolean): void;
}) {
  const [apiKey, setApiKey] = useState('');
  const save = useSaveProviderKey(slug);
  const submit = () =>
    save.mutate({ provider, apiKey: apiKey.trim() }, { onSuccess: () => onOpenChange(false) });

  return (
    <Dialog open onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogTitle>{LABEL[provider]} key for this workspace</DialogTitle>
        <DialogDescription>
          Used instead of the key in the API's .env for this workspace only. It is checked with{' '}
          {LABEL[provider]} first, stored encrypted, and never shown again: only its last four characters.
        </DialogDescription>
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="provider-key" label="API key">
            <Input
              id="provider-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          {save.error && (
            <p role="alert" className="text-destructive text-sm">
              {providerKeyErrorMessage(save.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending || apiKey.trim().length < 8}>
              {save.isPending ? 'Checking…' : 'Save key'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
