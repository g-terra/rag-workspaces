import type { Workspace } from '@rag/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { sourceChoices, sourcesError, validateComposite, type CompositeForm } from '@/workspaces/composite';
import { createErrorMessage } from '@/workspaces/create';
import { useCreateWorkspace, useUpdateWorkspace, useWorkspaces } from '@/workspaces/queries';
import { suggestSlug } from '@/workspaces/slug';

/** Checkboxes for the standard workspaces a composite answers from, in the order they were ticked. */
function SourcePicker({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: string[];
  onChange(sources: string[]): void;
  error?: string;
}) {
  const workspaces = useWorkspaces();
  const choices = sourceChoices(workspaces.data ?? []);
  return (
    <fieldset aria-describedby={`${id}-note`}>
      <legend className="mb-1.5 block text-[13px] font-medium">Sources</legend>
      <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
        {workspaces.isPending && <span className="text-muted-foreground text-xs">Loading…</span>}
        {workspaces.isError && (
          <span role="alert" className="text-destructive text-xs">
            Couldn't load the workspaces: {workspaces.error.message}
          </span>
        )}
        {choices.map((w: Workspace) => (
          <label key={w.slug} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.includes(w.slug)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, w.slug] : value.filter((s) => s !== w.slug))
              }
            />
            {w.name} <span className="text-muted-foreground font-mono text-xs">{w.slug}</span>
          </label>
        ))}
      </div>
      <p
        id={`${id}-note`}
        aria-live="polite"
        className={error ? 'text-destructive mt-1.5 text-xs' : 'text-muted-foreground mt-1.5 text-xs'}
      >
        {error ??
          'Two to ten workspaces. Each is searched with its own embedding model; anyone with access here can ask across all of them.'}
      </p>
    </fieldset>
  );
}

/** `POST /v1/workspaces` with `kind: "composite"`: a name, a slug and the sources. Chat settings come after, in Settings. */
export function CreateCompositeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const empty: CompositeForm = { name: '', slug: '', description: '', sources: [] };
  const [form, setForm] = useState(empty);
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof CompositeForm, string>>>({});
  const create = useCreateWorkspace();
  const navigate = useNavigate();
  const failure = create.error ? createErrorMessage(create.error) : null;

  const close = (next: boolean) => {
    if (create.isPending) return;
    if (!next) {
      setForm(empty);
      setSlugEdited(false);
      setErrors({});
      create.reset();
    }
    onOpenChange(next);
  };

  const submit = () => {
    const checked = validateComposite(form);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    create.mutate(checked.body, {
      onSuccess: (ws) => {
        close(false);
        void navigate(`/w/${ws.slug}`);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogTitle>New composite workspace</DialogTitle>
        <DialogDescription>
          One slug and one API over several workspaces. It holds no documents: questions are answered from its
          sources' material, with this workspace's own chat model, prompt, style, keys and members.
        </DialogDescription>
        <Field id="composite-name" label="Name" error={errors.name}>
          <Input
            id="composite-name"
            aria-describedby="composite-name-note"
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({ ...f, name, slug: slugEdited ? f.slug : suggestSlug(name) }));
              setErrors((x) => ({ ...x, name: undefined }));
            }}
          />
        </Field>
        <Field
          id="composite-slug"
          label="Slug"
          error={errors.slug ?? (failure?.field === 'slug' ? failure.message : undefined)}
          hint="Part of every route; it can't change later."
        >
          <Input
            id="composite-slug"
            aria-describedby="composite-slug-note"
            className="font-mono text-[13px]"
            value={form.slug}
            onChange={(e) => {
              setSlugEdited(true);
              setForm((f) => ({ ...f, slug: e.target.value }));
              setErrors((x) => ({ ...x, slug: undefined }));
            }}
          />
        </Field>
        <Field id="composite-description" label="Description" error={errors.description}>
          <Input
            id="composite-description"
            aria-describedby="composite-description-note"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
        <SourcePicker
          id="composite-sources"
          value={form.sources}
          error={errors.sources}
          onChange={(sources) => {
            setForm((f) => ({ ...f, sources }));
            setErrors((x) => ({ ...x, sources: undefined }));
          }}
        />
        {failure && failure.field !== 'slug' && (
          <p role="alert" className="text-destructive text-sm">
            {failure.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={create.isPending} onClick={submit}>
            {create.isPending ? 'Creating…' : 'Create composite'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Settings section of a composite: change which workspaces it answers from. Keyed on the saved
 * list, so a refetch that changes it (a source deleted elsewhere) starts the picker afresh.
 */
export function CompositeSourcesSettings({ workspace }: { workspace: Workspace }) {
  return <SourcesForm key={(workspace.sources ?? []).join(',')} workspace={workspace} />;
}

function SourcesForm({ workspace }: { workspace: Workspace }) {
  const saved = workspace.sources ?? [];
  const [sources, setSources] = useState(saved);
  const [error, setError] = useState<string>();
  const save = useUpdateWorkspace(workspace.slug);
  const dirty = sources.length !== saved.length || sources.some((s, i) => s !== saved[i]);

  return (
    <div className="flex flex-col gap-3">
      <SourcePicker
        id="ws-sources"
        value={sources}
        error={error ?? (save.error ? save.error.message : undefined)}
        onChange={(next) => {
          setSources(next);
          setError(undefined);
          save.reset();
        }}
      />
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => {
            const problem = sourcesError(sources);
            if (problem) return setError(problem);
            save.mutate({ sources }, { onSuccess: (ws) => setSources(ws.sources ?? []) });
          }}
        >
          {save.isPending ? 'Saving…' : 'Save sources'}
        </Button>
        {save.isSuccess && !dirty && (
          <span role="status" className="text-muted-foreground text-xs">
            Sources saved.
          </span>
        )}
      </div>
    </div>
  );
}
