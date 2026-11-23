import type { ApiKey, CreatedApiKey, Workspace, WorkspaceRole } from '@rag/shared';
import { Check, Copy } from 'lucide-react';
import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  curlExample,
  validateCreate,
  validateEdit,
  type Errors,
  type ExpiryChoice,
  type KeyForm,
} from '@/api-keys/keys';
import { useCreateApiKey, useRevokeApiKey, useUpdateApiKey } from '@/api-keys/queries';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useWorkspaces } from '@/workspaces/queries';

const EXPIRY: [ExpiryChoice, string][] = [
  ['never', 'Never'],
  ['30d', 'In 30 days'],
  ['90d', 'In 90 days'],
  ['custom', 'Custom date'],
];

const ROLES: [WorkspaceRole, string][] = [
  ['reader', 'ask, chat, search'],
  ['editor', 'also upload, delete'],
];

const selectClass =
  'border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-2.5 text-sm shadow-xs';

/** `POST /v1/api-keys`, then the secret, which the API never shows again. */
export function CreateApiKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const create = useCreateApiKey();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return;
        if (!next) {
          setCreated(null);
          create.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-5 sm:max-w-150">
        {created ? (
          <SecretPanel created={created} onDone={() => onOpenChange(false)} />
        ) : (
          <CreateForm pending={create.isPending} onSubmit={create.mutate} onCreated={setCreated} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({
  pending,
  onSubmit,
  onCreated,
}: {
  pending: boolean;
  onSubmit: ReturnType<typeof useCreateApiKey>['mutate'];
  onCreated(key: CreatedApiKey): void;
}) {
  const [form, setForm] = useState<KeyForm>({
    name: '',
    role: 'reader',
    workspaces: [],
    expiry: 'never',
    customDate: '',
  });
  const [errors, setErrors] = useState<Errors>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const checked = validateCreate(form);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    onSubmit(checked.body, {
      onSuccess: onCreated,
      onError: (err) => setErrors({ form: err.message }),
    });
  };

  return (
    <>
      <div className="space-y-1.5">
        <DialogTitle>Create API key</DialogTitle>
        <DialogDescription>The secret is shown once, right after you create it.</DialogDescription>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <KeyFields form={form} setForm={setForm} errors={errors} withRole />
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
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create key'}
          </Button>
        </div>
      </form>
    </>
  );
}

/** Rename, rebind or re-date a key. The role is shown but never sent: the API answers 400. */
export function EditApiKeyDialog({
  apiKey,
  onOpenChange,
}: {
  apiKey: ApiKey;
  onOpenChange(open: boolean): void;
}) {
  const update = useUpdateApiKey(apiKey.id);
  const [form, setForm] = useState<KeyForm>({
    name: apiKey.name,
    role: apiKey.role,
    workspaces: apiKey.workspaces,
    expiry: apiKey.expiresAt ? 'custom' : 'never',
    customDate: apiKey.expiresAt?.slice(0, 10) ?? '',
  });
  const [errors, setErrors] = useState<Errors>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const checked = validateEdit(form, apiKey);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    update.mutate(checked.body, {
      onSuccess: () => onOpenChange(false),
      onError: (err) => setErrors({ form: err.message }),
    });
  };

  return (
    <Dialog open onOpenChange={(next) => !update.isPending && onOpenChange(next)}>
      <DialogContent className="gap-5 sm:max-w-150">
        <div className="space-y-1.5">
          <DialogTitle>Edit API key</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{apiKey.prefix}••••</span> · role{' '}
            <span data-testid="key-role" className="font-medium">
              {apiKey.role}
            </span>
            . A key's role never changes: create a new key instead, so no key gains rights silently.
          </DialogDescription>
        </div>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <KeyFields form={form} setForm={setForm} errors={errors} />
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
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeApiKeyDialog({
  apiKey,
  onOpenChange,
}: {
  apiKey: ApiKey;
  onOpenChange(open: boolean): void;
}) {
  const revoke = useRevokeApiKey(apiKey.id);
  return (
    <Dialog open onOpenChange={(next) => !revoke.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogTitle>Revoke "{apiKey.name}"?</DialogTitle>
        <DialogDescription>
          The key stops working at once and can't be brought back. It stays listed, so its usage history keeps
          its name.
        </DialogDescription>
        {revoke.error && (
          <p role="alert" className="text-destructive text-sm">
            {revoke.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
          >
            {revoke.isPending ? 'Revoking…' : 'Revoke key'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Name, role, workspaces and expiry. The role is a choice only while creating. */
function KeyFields({
  form,
  setForm,
  errors,
  withRole = false,
}: {
  form: KeyForm;
  setForm: Dispatch<SetStateAction<KeyForm>>;
  errors: Errors;
  withRole?: boolean;
}) {
  const workspaces = useWorkspaces();
  return (
    <>
      <Field id="key-name" label="Name" error={errors.name} hint="What this key is for, in a few words.">
        <Input
          id="key-name"
          aria-describedby="key-name-note"
          aria-invalid={!!errors.name}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {withRole && (
          <div>
            <span className="mb-1.5 block text-[13px] font-medium">Role</span>
            <div className="flex flex-col gap-2">
              {ROLES.map(([role, what]) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="key-role"
                    checked={form.role === role}
                    onChange={() => setForm((f) => ({ ...f, role }))}
                  />
                  {role} <span className="text-muted-foreground text-xs">{what}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <span className="mb-1.5 block text-[13px] font-medium">Workspaces</span>
          <div className="flex max-h-32 flex-col gap-2 overflow-y-auto">
            {workspaces.isPending && <span className="text-muted-foreground text-xs">Loading…</span>}
            {workspaces.data?.map((w: Workspace) => (
              <label key={w.slug} className="flex items-center gap-2 text-sm" title={w.name}>
                <input
                  type="checkbox"
                  checked={form.workspaces.includes(w.slug)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      workspaces: e.target.checked
                        ? [...f.workspaces, w.slug]
                        : f.workspaces.filter((s) => s !== w.slug),
                    }))
                  }
                />
                <span className="font-mono text-[13px]">{w.slug}</span>
              </label>
            ))}
          </div>
          {errors.workspaces && (
            <p role="alert" className="text-destructive mt-1.5 text-xs">
              {errors.workspaces}
            </p>
          )}
        </div>
      </div>
      <Field id="key-expiry" label="Expires" error={errors.customDate}>
        <select
          id="key-expiry"
          aria-describedby="key-expiry-note"
          className={selectClass}
          value={form.expiry}
          onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value as ExpiryChoice }))}
        >
          {EXPIRY.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {form.expiry === 'custom' && (
          <Input
            type="date"
            aria-label="Expiry date"
            className="mt-2"
            aria-invalid={!!errors.customDate}
            value={form.customDate}
            onChange={(e) => setForm((f) => ({ ...f, customDate: e.target.value }))}
          />
        )}
      </Field>
    </>
  );
}

/** The one time the secret exists outside the API: copy it, or run the example. */
function SecretPanel({ created, onDone }: { created: CreatedApiKey; onDone(): void }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const example = curlExample(window.location.origin, created.workspaces[0] ?? '<slug>', created.secret);

  return (
    <>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-8 flex-none items-center justify-center rounded-full bg-green-100 text-green-800">
          <Check className="size-4" />
        </span>
        <div className="space-y-1.5">
          <DialogTitle>{created.name} created</DialogTitle>
          <DialogDescription>
            {created.role} · {created.workspaces.join(', ')} ·{' '}
            {created.expiresAt
              ? `expires ${new Date(created.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'never expires'}
            . Copy the secret now; it won't be shown again.
          </DialogDescription>
        </div>
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          aria-label="Secret"
          value={created.secret}
          className="bg-muted/50 font-mono text-xs"
        />
        <Button
          variant="outline"
          onClick={() => {
            navigator.clipboard
              .writeText(created.secret)
              .then(() => setCopied(true))
              .catch(() => setCopyFailed(true));
          }}
        >
          <Copy /> {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {copyFailed && (
        <p role="alert" className="text-muted-foreground text-xs">
          Couldn't reach the clipboard. Select the secret above and copy it by hand.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium">Try it</p>
        <pre
          data-testid="curl-example"
          className="bg-foreground text-background overflow-x-auto rounded-lg p-3.5 font-mono text-xs leading-relaxed"
        >
          {example}
        </pre>
      </div>
      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </>
  );
}
