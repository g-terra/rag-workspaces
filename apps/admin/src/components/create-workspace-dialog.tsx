import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { createErrorMessage, validateCreate, type CreateForm } from '@/workspaces/create';
import { useCreateWorkspace } from '@/workspaces/queries';
import { suggestSlug } from '@/workspaces/slug';

/** The admin's "Create workspace" dialog. Model settings keep the defaults from `.env`. */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5">
        <div className="space-y-1.5">
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            Creates a Chroma collection and its own routes. You can add members afterwards.
          </DialogDescription>
        </div>
        {/* Unmounted when closed, so the form starts empty every time. */}
        <CreateForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone(): void }) {
  const navigate = useNavigate();
  const create = useCreateWorkspace();
  const [form, setForm] = useState<CreateForm>({ name: '', slug: '', description: '' });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof CreateForm | 'form', string>>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const checked = validateCreate(form);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    create.mutate(checked.body, {
      onSuccess: (ws) => {
        onDone();
        void navigate(`/w/${ws.slug}`);
      },
      onError: (err) => {
        const { field, message } = createErrorMessage(err);
        setErrors({ [field ?? 'form']: message });
      },
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field id="ws-name" label="Name" error={errors.name}>
        <Input
          id="ws-name"
          value={form.name}
          aria-invalid={!!errors.name}
          onChange={(e) => {
            const name = e.target.value;
            setForm((f) => ({ ...f, name, slug: slugEdited ? f.slug : suggestSlug(name) }));
          }}
        />
      </Field>
      <Field
        id="ws-slug"
        label="Slug"
        error={errors.slug}
        hint={
          <>
            Used in routes: <span className="font-mono">/v1/workspaces/{form.slug || '…'}/…</span> Lower case,
            can't change later.
          </>
        }
      >
        <Input
          id="ws-slug"
          className="font-mono"
          value={form.slug}
          aria-invalid={!!errors.slug}
          onChange={(e) => {
            setSlugEdited(true);
            setForm((f) => ({ ...f, slug: e.target.value }));
          }}
        />
      </Field>
      <Field id="ws-desc" label="Description" error={errors.description}>
        <Input
          id="ws-desc"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </Field>
      <p className="text-muted-foreground text-xs">
        Model and retrieval settings use the defaults from <span className="font-mono">.env</span>.
      </p>
      {errors.form && (
        <p role="alert" className="text-destructive text-sm">
          {errors.form}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create workspace'}
        </Button>
      </div>
    </form>
  );
}

function Field(props: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={props.id} className="mb-1.5 block text-[13px] font-medium">
        {props.label}
      </label>
      {props.children}
      {props.error ? (
        <p className="text-destructive mt-1.5 text-xs">{props.error}</p>
      ) : (
        props.hint && <p className="text-muted-foreground mt-1.5 text-xs">{props.hint}</p>
      )}
    </div>
  );
}
