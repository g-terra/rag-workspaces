import type { HostedProvider, SystemStatus } from '@rag/shared';
import { useState, type ReactNode, type RefObject } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSystem } from '@/system/queries';
import { createErrorMessage } from '@/workspaces/create';
import { providerKeyErrorMessage, useCheckProviderKey } from '@/workspaces/providers';
import { useCreateWorkspace } from '@/workspaces/queries';
import {
  chatProviderChoices,
  defaultPlaceholder,
  hostedEmbeddingWarning,
  hostedWarning,
  REASONING_EFFORTS,
  reasoningDefaultNote,
} from '@/workspaces/settings';
import { suggestSlug } from '@/workspaces/slug';
import {
  buildCreate,
  emptyWizard,
  missingKeys,
  modelsFor,
  STEPS,
  type TypedKeys,
  type WizardErrors,
  type WizardForm,
} from '@/workspaces/wizard';

const selectClass =
  'border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-2.5 text-sm shadow-xs';

/**
 * The admin's "Create workspace" wizard: basics, models (with keys for hosted providers), retrieval,
 * then a review. Only the basics are required: "Create workspace" works from any step, and whatever
 * was left empty keeps the defaults from `.env`. `returnFocusTo` is the control that opened it, which
 * gets focus back when it closes (the dialog is opened from state, so Radix doesn't know its opener).
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const create = useCreateWorkspace();
  const [saving, setSaving] = useState(false);
  const busy = create.isPending || saving;
  return (
    <Dialog
      open={open}
      // While the request runs the dialog stays open, so its success can still navigate to the workspace.
      onOpenChange={(next) => {
        if (next || !busy) onOpenChange(next);
      }}
    >
      <DialogContent
        className="gap-5 sm:max-w-2xl"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        <div className="space-y-1.5">
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            Creates a Chroma collection and its own routes. Only the basics are needed; anything you skip uses
            the defaults from .env and can be changed later in Settings.
          </DialogDescription>
        </div>
        {/* Unmounted when closed, so the wizard starts empty every time. */}
        <Wizard create={create} setSaving={setSaving} busy={busy} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Wizard({
  create,
  setSaving,
  busy,
  onDone,
}: {
  create: ReturnType<typeof useCreateWorkspace>;
  setSaving(saving: boolean): void;
  busy: boolean;
  onDone(): void;
}) {
  const navigate = useNavigate();
  const { api } = useAuth();
  const system = useSystem().data;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(emptyWizard);
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<WizardErrors & { form?: string }>({});
  // Keys that passed the provider's check, and the models it listed with them.
  const [keys, setKeys] = useState<TypedKeys>({});
  const [checked, setChecked] = useState<Partial<Record<HostedProvider, string[]>>>({});

  const set = (field: keyof WizardForm, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors(({ [field]: _gone, form: _f, ...rest }) => rest);
  };

  const submit = () => {
    const built = buildCreate(form, keys, system);
    if (!built.ok) {
      setErrors(built.errors);
      setStep(built.step);
      return;
    }
    setErrors({});
    create.mutate(built.body, {
      onSuccess: async (ws) => {
        // The workspace exists now, so its keys have somewhere to go. They were checked already; if
        // one still fails, Settings shows which provider has no key.
        setSaving(true);
        let allSaved = true;
        for (const { provider, apiKey } of built.keys) {
          try {
            await api(`/v1/workspaces/${encodeURIComponent(ws.slug)}/providers/${provider}/key`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ apiKey }),
            });
          } catch {
            allSaved = false;
          }
        }
        setSaving(false);
        onDone();
        void navigate(allSaved ? `/w/${ws.slug}` : `/w/${ws.slug}/settings`);
      },
      onError: (err) => {
        const { field, message } = createErrorMessage(err);
        setErrors({ [field ?? 'form']: message });
        if (field) setStep(0);
      },
    });
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              aria-current={i === step ? 'step' : undefined}
              onClick={() => setStep(i)}
              className={
                i === step
                  ? 'bg-primary text-primary-foreground rounded-full px-2.5 py-1 font-medium'
                  : 'text-muted-foreground hover:bg-accent rounded-full px-2.5 py-1'
              }
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Basics
          form={form}
          errors={errors}
          set={set}
          onName={(name) => {
            setForm((f) => ({ ...f, name, slug: slugEdited ? f.slug : suggestSlug(name) }));
            setErrors(({ name: _n, ...rest }) => rest);
          }}
          onSlug={(slug) => {
            setSlugEdited(true);
            set('slug', slug);
          }}
        />
      )}
      {step === 1 && (
        <Models
          form={form}
          errors={errors}
          set={set}
          setForm={setForm}
          system={system}
          keys={keys}
          checked={checked}
          onChecked={(provider, apiKey, models) => {
            setKeys((k) => ({ ...k, [provider]: apiKey }));
            setChecked((c) => ({ ...c, [provider]: models }));
            setErrors(({ keys: _k, ...rest }) => rest);
          }}
        />
      )}
      {step === 2 && <Retrieval form={form} errors={errors} set={set} system={system} />}
      {step === 3 && <Review form={form} keys={keys} system={system} />}

      {errors.form && (
        <p role="alert" className="text-destructive text-sm">
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="outline" className="mr-auto">
            Cancel
          </Button>
        </DialogClose>
        {step > 0 && (
          <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1 && (
          <Button type="button" variant="outline" onClick={() => setStep(step + 1)}>
            Next: {STEPS[step + 1]}
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {create.isPending ? 'Creating…' : busy ? 'Saving keys…' : 'Create workspace'}
        </Button>
      </div>
    </form>
  );
}

type StepProps = {
  form: WizardForm;
  errors: WizardErrors;
  set(field: keyof WizardForm, value: string): void;
};

function Basics({
  form,
  errors,
  set,
  onName,
  onSlug,
}: StepProps & { onName(v: string): void; onSlug(v: string): void }) {
  return (
    <>
      <Field id="ws-name" label="Name" error={errors.name}>
        <Input
          id="ws-name"
          aria-describedby="ws-name-note"
          value={form.name}
          aria-invalid={!!errors.name}
          onChange={(e) => onName(e.target.value)}
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
          aria-describedby="ws-slug-note"
          className="font-mono"
          value={form.slug}
          aria-invalid={!!errors.slug}
          onChange={(e) => onSlug(e.target.value)}
        />
      </Field>
      <Field id="ws-desc" label="Description" error={errors.description}>
        <Input
          id="ws-desc"
          aria-describedby="ws-desc-note"
          value={form.description}
          aria-invalid={!!errors.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
    </>
  );
}

function ModelPicker({
  id,
  label,
  value,
  models,
  error,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  models: string[];
  error?: string;
  disabled: boolean;
  onChange(v: string): void;
}) {
  return (
    <Field id={id} label={label} error={error} hint={disabled ? 'Pick a provider first.' : undefined}>
      {models.length > 0 ? (
        <select
          id={id}
          aria-describedby={`${id}-note`}
          aria-invalid={!!error}
          className={selectClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Pick a model…</option>
          {(value && !models.includes(value) ? [value, ...models] : models).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          aria-describedby={`${id}-note`}
          aria-invalid={!!error}
          disabled={disabled}
          placeholder={disabled ? 'Default' : 'Model id, as the provider names it'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

function Models({
  form,
  errors,
  set,
  setForm,
  system,
  keys,
  checked,
  onChecked,
}: StepProps & {
  setForm(update: (f: WizardForm) => WizardForm): void;
  system: SystemStatus | undefined;
  keys: TypedKeys;
  checked: Partial<Record<HostedProvider, string[]>>;
  onChecked(provider: HostedProvider, apiKey: string, models: string[]): void;
}) {
  const embedding = modelsFor(form.embeddingProvider, system, checked);
  // Models whose id says they embed first; the API can't tell which ones do.
  const embeddingOrdered = [
    ...embedding.filter((m) => /embed/i.test(m)),
    ...embedding.filter((m) => !/embed/i.test(m)),
  ];
  const needKeys = missingKeys(form, system, {});
  const chatWarning = hostedWarning(form.chatProvider);
  const embedWarning = form.embeddingProvider ? hostedEmbeddingWarning(form.embeddingProvider) : null;
  const defaults = system?.defaults;

  return (
    <>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field
          id="wz-chat-provider"
          label="Chat provider"
          error={errors.chatProvider}
          hint={defaults ? `Default: ${defaults.chat.provider} / ${defaults.chat.model}` : undefined}
        >
          <select
            id="wz-chat-provider"
            aria-describedby="wz-chat-provider-note"
            className={selectClass}
            value={form.chatProvider}
            onChange={(e) => setForm((f) => ({ ...f, chatProvider: e.target.value, chatModel: '' }))}
          >
            <option value="">Default</option>
            {chatProviderChoices(system).map((c) => (
              <option key={c.id} value={c.id}>
                {c.note && !keys[c.id as HostedProvider] ? `${c.id} — ${c.note}` : c.id}
              </option>
            ))}
          </select>
        </Field>
        <ModelPicker
          id="wz-chat-model"
          label="Chat model"
          value={form.chatModel}
          models={modelsFor(form.chatProvider, system, checked)}
          error={errors.chatModel}
          disabled={!form.chatProvider}
          onChange={(v) => set('chatModel', v)}
        />
        <Field
          id="wz-embedding-provider"
          label="Embedding provider"
          error={errors.embeddingProvider}
          hint={
            defaults
              ? `Default: ${defaults.embedding.provider} / ${defaults.embedding.model}. Fixed once created; changing it later means a reindex.`
              : 'Fixed once created; changing it later means a reindex.'
          }
        >
          <select
            id="wz-embedding-provider"
            aria-describedby="wz-embedding-provider-note"
            className={selectClass}
            value={form.embeddingProvider}
            onChange={(e) =>
              setForm((f) => ({ ...f, embeddingProvider: e.target.value, embeddingModel: '' }))
            }
          >
            <option value="">Default</option>
            {(system?.providers ?? [])
              .filter((p) => p.embeddings)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
          </select>
        </Field>
        <ModelPicker
          id="wz-embedding-model"
          label="Embedding model"
          value={form.embeddingModel}
          models={embeddingOrdered}
          error={errors.embeddingModel}
          disabled={!form.embeddingProvider}
          onChange={(v) => set('embeddingModel', v)}
        />
      </div>

      {needKeys.map((provider) => (
        <KeyCheck key={provider} provider={provider} saved={keys[provider]} onChecked={onChecked} />
      ))}
      {errors.keys && (
        <p role="alert" className="text-destructive text-sm">
          {errors.keys}
        </p>
      )}

      <Field id="wz-reasoning" label="Reasoning effort" hint={reasoningDefaultNote(system)}>
        <select
          id="wz-reasoning"
          aria-describedby="wz-reasoning-note"
          className={selectClass}
          value={form.reasoningEffort}
          onChange={(e) => set('reasoningEffort', e.target.value)}
        >
          <option value="">Default</option>
          {REASONING_EFFORTS.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      </Field>

      {[chatWarning, embedWarning].filter(Boolean).map((w) => (
        <p
          key={w}
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {w}
        </p>
      ))}
    </>
  );
}

/** A key field for a provider with no key in .env: checked with the provider, kept until create. */
function KeyCheck({
  provider,
  saved,
  onChecked,
}: {
  provider: HostedProvider;
  saved: string | undefined;
  onChecked(provider: HostedProvider, apiKey: string, models: string[]): void;
}) {
  const [value, setValue] = useState(saved ?? '');
  const check = useCheckProviderKey();
  const id = `wz-key-${provider}`;
  const ok = !!saved && saved === value.trim();
  return (
    <div className="rounded-lg border p-3.5">
      <Field
        id={id}
        label={`${provider} API key`}
        error={check.error ? providerKeyErrorMessage(check.error) : undefined}
        hint={
          ok
            ? `The key works. It is saved, encrypted, for this workspace when it is created.`
            : `There is no ${provider} key in the API's .env. This one is used by this workspace only.`
        }
      >
        <div className="flex gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-note`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              // A changed key has to be checked again before it counts.
              if (saved) onChecked(provider, '', []);
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0"
            disabled={check.isPending || value.trim().length < 20 || ok}
            onClick={() =>
              check.mutate(
                { provider, apiKey: value.trim() },
                { onSuccess: (status) => onChecked(provider, value.trim(), status.models) },
              )
            }
          >
            {check.isPending ? 'Checking…' : ok ? 'Key works' : 'Check key'}
          </Button>
        </div>
      </Field>
    </div>
  );
}

function Retrieval({ form, errors, set, system }: StepProps & { system: SystemStatus | undefined }) {
  const number = (field: 'chunkSize' | 'chunkOverlap' | 'topK' | 'minScore', label: string, hint: string) => (
    <Field id={`wz-${field}`} label={label} error={errors[field]} hint={hint}>
      <Input
        id={`wz-${field}`}
        inputMode="decimal"
        aria-describedby={`wz-${field}-note`}
        aria-invalid={!!errors[field]}
        placeholder={defaultPlaceholder(system, field)}
        value={form[field]}
        onChange={(e) => set(field, e.target.value)}
      />
    </Field>
  );
  return (
    <>
      <div className="grid gap-3.5 sm:grid-cols-2">
        {number('chunkSize', 'Chunk size', 'Characters per passage.')}
        {number('chunkOverlap', 'Chunk overlap', 'Characters each passage repeats from the one before.')}
        {number('topK', 'Top-k passages', 'How many passages an answer may cite.')}
        {number('minScore', 'Relevance threshold', "Below this, answers say the material doesn't cover it.")}
      </div>
      <Field id="wz-prompt" label="System prompt" error={errors.systemPrompt}>
        <textarea
          id="wz-prompt"
          aria-describedby="wz-prompt-note"
          className="border-input dark:bg-input/30 min-h-21 w-full resize-y rounded-md border bg-transparent px-3 py-2.5 text-sm leading-relaxed shadow-xs"
          placeholder={defaultPlaceholder(system, 'systemPrompt')}
          value={form.systemPrompt}
          onChange={(e) => set('systemPrompt', e.target.value)}
        />
      </Field>
    </>
  );
}

function Review({
  form,
  keys,
  system,
}: {
  form: WizardForm;
  keys: TypedKeys;
  system: SystemStatus | undefined;
}) {
  const or = (value: string, fallback = 'Default') => value.trim() || fallback;
  const pair = (provider: string, model: string) => (provider ? `${provider} / ${model || '…'}` : 'Default');
  const keyList = Object.keys(keys).filter((p) => p === form.chatProvider || p === form.embeddingProvider);
  const rows: [string, ReactNode][] = [
    ['Name', or(form.name, '…')],
    ['Slug', <span className="font-mono">{or(form.slug, '…')}</span>],
    ['Chat model', pair(form.chatProvider, form.chatModel)],
    ['Embedding model', pair(form.embeddingProvider, form.embeddingModel)],
    ['Keys saved for this workspace', keyList.length ? keyList.join(', ') : 'None'],
    ['Reasoning effort', or(form.reasoningEffort)],
    ['Chunk size / overlap', `${or(form.chunkSize)} / ${or(form.chunkOverlap)}`],
    ['Top-k / threshold', `${or(form.topK)} / ${or(form.minScore)}`],
    ['System prompt', form.systemPrompt.trim() ? 'Custom' : 'Default'],
  ];
  return (
    <>
      <dl className="divide-y rounded-lg border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-4 px-3.5 py-2">
            <dt className="text-muted-foreground w-52 shrink-0">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {!system && (
        <p className="text-muted-foreground text-xs">
          The defaults couldn't be read; empty settings use the API's .env.
        </p>
      )}
    </>
  );
}
