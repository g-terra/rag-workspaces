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
  modelsFor,
  needsKey,
  REVIEW,
  stepErrors,
  stepOf,
  STEPS,
  type TypedKeys,
  type WizardErrors,
  type WizardForm,
} from '@/workspaces/wizard';

const selectClass =
  'border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-2.5 text-sm shadow-xs';

/** Models listed when a key was checked, by provider. */
type Checked = Partial<Record<HostedProvider, string[]>>;

/**
 * The admin's "Create workspace" wizard: basics, the chat model, the embedding model, retrieval, then
 * a review. Each step has to be complete before Next moves on (a hosted provider's key is checked
 * before its models are offered), and the workspace is created only from the review. Settings left
 * empty keep the defaults from `.env`. `returnFocusTo` is the control that opened it, which gets focus
 * back when it closes (the dialog is opened from state, so Radix doesn't know its opener).
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
            A few steps, then a review where you create it. Anything you leave on Default uses the API's .env
            and can be changed later in Settings.
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
  // The furthest step reached, so the timeline can go forward again to a step already filled in.
  const [reached, setReached] = useState(0);
  const [form, setForm] = useState<WizardForm>(emptyWizard);
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<WizardErrors & { form?: string }>({});
  // Keys that passed the provider's check, the models it listed with them, and the step each was
  // checked on. One key serves chat and embeddings alike.
  const [keys, setKeys] = useState<TypedKeys>({});
  const [checked, setChecked] = useState<Checked>({});
  const [checkedOn, setCheckedOn] = useState<Partial<Record<HostedProvider, number>>>({});

  const set = (field: keyof WizardForm, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors(({ [field]: _gone, form: _f, ...rest }) => rest);
  };

  const onChecked = (provider: HostedProvider, apiKey: string, models: string[]) => {
    const drop = <T,>({ [provider]: _gone, ...rest }: Partial<Record<HostedProvider, T>>) => rest;
    if (!apiKey) {
      // A changed key has to be checked again before it counts.
      setKeys(drop);
      setChecked(drop);
      setCheckedOn(drop);
      return;
    }
    setKeys((k) => ({ ...k, [provider]: apiKey }));
    setChecked((c) => ({ ...c, [provider]: models }));
    setCheckedOn((o) => ({ ...o, [provider]: step }));
    setErrors(({ chatKey: _c, embeddingKey: _e, ...rest }) => rest);
  };

  // Steps with a problem of their own; the timeline can't skip past one.
  const incomplete = STEPS.map(
    (_, i) => i < REVIEW && Object.keys(stepErrors(i, form, keys, system)).length > 0,
  );

  const goTo = (target: number) => {
    setErrors({});
    setStep(target);
    setReached((r) => Math.max(r, target));
  };

  const next = () => {
    const problems = stepErrors(step, form, keys, system);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    goTo(step + 1);
  };

  const submit = () => {
    const built = buildCreate(form, keys, system);
    if (!built.ok) {
      setErrors(built.errors);
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
        if (field) setStep(stepOf(field));
      },
    });
  };

  const problems = step === REVIEW ? stepErrors(REVIEW, form, keys, system) : {};

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === REVIEW) submit();
        else next();
      }}
    >
      <Timeline step={step} reached={reached} incomplete={incomplete} onPick={goTo} />

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
        <ChatStep
          form={form}
          errors={errors}
          set={set}
          setForm={setForm}
          system={system}
          keys={keys}
          checked={checked}
          checkedOn={checkedOn}
          onChecked={onChecked}
        />
      )}
      {step === 2 && (
        <EmbeddingStep
          form={form}
          errors={errors}
          set={set}
          setForm={setForm}
          system={system}
          keys={keys}
          checked={checked}
          checkedOn={checkedOn}
          onChecked={onChecked}
        />
      )}
      {step === 3 && <Retrieval form={form} errors={errors} set={set} system={system} />}
      {step === REVIEW && <Review form={form} keys={keys} system={system} problems={problems} onFix={goTo} />}

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
          <Button type="button" variant="outline" onClick={() => goTo(step - 1)}>
            Back
          </Button>
        )}
        {step < REVIEW ? (
          <Button type="submit">Next: {STEPS[step + 1]}</Button>
        ) : (
          <Button type="submit" disabled={busy || Object.keys(problems).length > 0}>
            {create.isPending ? 'Creating…' : busy ? 'Saving keys…' : 'Create workspace'}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The steps in order, with the current one marked. A step already reached can be opened again, going
 * back always and forward as long as no step on the way has a problem.
 */
function Timeline({
  step,
  reached,
  incomplete,
  onPick,
}: {
  step: number;
  reached: number;
  incomplete: boolean[];
  onPick(step: number): void;
}) {
  return (
    <ol className="flex items-center gap-1 text-xs" aria-label="Steps">
      {STEPS.map((label, i) => {
        const current = i === step;
        const done = !current && i <= reached && !incomplete[i];
        const open = i < step || (i <= reached && !incomplete.slice(0, i).some(Boolean));
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1 last:flex-none">
            <button
              type="button"
              aria-current={current ? 'step' : undefined}
              disabled={!open && !current}
              onClick={() => onPick(i)}
              className="flex min-w-0 items-center gap-1.5 rounded-full py-1 pr-2 pl-1 enabled:hover:bg-accent disabled:cursor-default"
            >
              <span
                aria-hidden
                className={
                  current
                    ? 'bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full font-medium'
                    : done
                      ? 'border-primary text-primary flex size-5 shrink-0 items-center justify-center rounded-full border font-medium'
                      : 'text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full border'
                }
              >
                {done ? '✓' : i + 1}
              </span>
              <span
                className={
                  current
                    ? 'truncate font-medium'
                    : open
                      ? 'text-foreground truncate'
                      : 'text-muted-foreground truncate'
                }
              >
                {label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className={i < reached ? 'bg-primary h-px flex-1' : 'bg-border h-px flex-1'}
              />
            )}
          </li>
        );
      })}
    </ol>
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

type ModelStepProps = StepProps & {
  setForm(update: (f: WizardForm) => WizardForm): void;
  system: SystemStatus | undefined;
  keys: TypedKeys;
  checked: Checked;
  /** The step each key was checked on: a key checked on another step is reused, not asked for again. */
  checkedOn: Partial<Record<HostedProvider, number>>;
  onChecked(provider: HostedProvider, apiKey: string, models: string[]): void;
};

function StepIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      {children}
    </p>
  );
}

/**
 * The key part of a model step: nothing for a provider with a key in `.env`, a note when the key was
 * checked on another step, else a field to type the key and check it.
 */
function ProviderKey({
  step,
  provider,
  error,
  system,
  keys,
  checkedOn,
  onChecked,
}: Pick<ModelStepProps, 'system' | 'keys' | 'checkedOn' | 'onChecked'> & {
  step: number;
  provider: string;
  error?: string;
}) {
  // needsKey with no keys typed: hosted, and no key in .env.
  if (!needsKey(provider, system, {})) return null;
  const hosted = provider as HostedProvider;
  const on = checkedOn[hosted];
  if (keys[hosted] && on !== undefined && on !== step) {
    return (
      <p role="status" className="bg-muted/50 rounded-lg border px-3.5 py-2.5 text-sm">
        Uses the {provider} key you checked on the {STEPS[on]} step. Nothing to add here.
      </p>
    );
  }
  return (
    <KeyCheck key={provider} provider={hosted} saved={keys[hosted]} error={error} onChecked={onChecked} />
  );
}

function ChatStep({
  form,
  errors,
  set,
  setForm,
  system,
  keys,
  checked,
  checkedOn,
  onChecked,
}: ModelStepProps) {
  const provider = form.chatProvider;
  const defaults = system?.defaults;
  const warning = hostedWarning(provider);
  return (
    <>
      <StepIntro title="Chat: the model that writes answers">
        It reads the passages found for a question and writes the answer. Pick its provider; a hosted one
        needs an API key, checked before its models are listed.
      </StepIntro>
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
          value={provider}
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
      <ProviderKey
        step={1}
        provider={provider}
        error={errors.chatKey}
        system={system}
        keys={keys}
        checkedOn={checkedOn}
        onChecked={onChecked}
      />
      {needsKey(provider, system, keys) ? (
        <p className="text-muted-foreground text-sm">
          Check the key to pick a model and the reasoning effort.
        </p>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <ModelPicker
            id="wz-chat-model"
            label="Chat model"
            value={form.chatModel}
            models={modelsFor(provider, system, checked)}
            error={errors.chatModel}
            disabled={!provider}
            onChange={(v) => set('chatModel', v)}
          />
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
        </div>
      )}
      {warning && <Warning>{warning}</Warning>}
    </>
  );
}

function EmbeddingStep({
  form,
  errors,
  set,
  setForm,
  system,
  keys,
  checked,
  checkedOn,
  onChecked,
}: ModelStepProps) {
  const provider = form.embeddingProvider;
  const defaults = system?.defaults;
  const models = modelsFor(provider, system, checked);
  // Models whose id says they embed first; the API can't tell which ones do.
  const ordered = [...models.filter((m) => /embed/i.test(m)), ...models.filter((m) => !/embed/i.test(m))];
  const warning = provider ? hostedEmbeddingWarning(provider) : null;
  return (
    <>
      <StepIntro title="Embeddings: the model that indexes your material">
        It turns documents and questions into vectors so the right passages are found. It is fixed once the
        workspace exists; changing it later means a reindex.
      </StepIntro>
      <Field
        id="wz-embedding-provider"
        label="Embedding provider"
        error={errors.embeddingProvider}
        hint={defaults ? `Default: ${defaults.embedding.provider} / ${defaults.embedding.model}` : undefined}
      >
        <select
          id="wz-embedding-provider"
          aria-describedby="wz-embedding-provider-note"
          className={selectClass}
          value={provider}
          onChange={(e) => setForm((f) => ({ ...f, embeddingProvider: e.target.value, embeddingModel: '' }))}
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
      <ProviderKey
        step={2}
        provider={provider}
        error={errors.embeddingKey}
        system={system}
        keys={keys}
        checkedOn={checkedOn}
        onChecked={onChecked}
      />
      {needsKey(provider, system, keys) ? (
        <p className="text-muted-foreground text-sm">Check the key to pick a model.</p>
      ) : (
        <ModelPicker
          id="wz-embedding-model"
          label="Embedding model"
          value={form.embeddingModel}
          models={ordered}
          error={errors.embeddingModel}
          disabled={!provider}
          onChange={(v) => set('embeddingModel', v)}
        />
      )}
      {warning && <Warning>{warning}</Warning>}
    </>
  );
}

/** A key field for a provider with no key in .env: checked with the provider, kept until create. */
function KeyCheck({
  provider,
  saved,
  error,
  onChecked,
}: {
  provider: HostedProvider;
  saved: string | undefined;
  error?: string;
  onChecked(provider: HostedProvider, apiKey: string, models: string[]): void;
}) {
  const [value, setValue] = useState(saved ?? '');
  const check = useCheckProviderKey();
  const id = `wz-key-${provider}`;
  const ok = !!saved && saved === value.trim();
  const run = () =>
    check.mutate(
      { provider, apiKey: value.trim() },
      { onSuccess: (status) => onChecked(provider, value.trim(), status.models) },
    );
  return (
    <div className="rounded-lg border p-3.5">
      <Field
        id={id}
        label={`${provider} API key`}
        error={check.error ? providerKeyErrorMessage(check.error) : ok ? undefined : error}
        hint={
          ok
            ? `The key works. It is saved, encrypted, for this workspace when you create it, and reused wherever ${provider} is picked.`
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
              if (saved) onChecked(provider, '', []);
            }}
            onKeyDown={(e) => {
              // Enter checks the key instead of moving to the next step.
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!ok && value.trim().length >= 20 && !check.isPending) run();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-9 shrink-0"
            disabled={check.isPending || value.trim().length < 20 || ok}
            onClick={run}
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
  problems,
  onFix,
}: {
  form: WizardForm;
  keys: TypedKeys;
  system: SystemStatus | undefined;
  problems: WizardErrors;
  onFix(step: number): void;
}) {
  const or = (value: string, fallback = 'Default') => value.trim() || fallback;
  const pair = (provider: string, model: string) => (provider ? `${provider} / ${model || '…'}` : 'Default');
  const keyList = Object.keys(keys).filter((p) => p === form.chatProvider || p === form.embeddingProvider);
  const rows: [string, ReactNode][] = [
    ['Name', or(form.name, '…')],
    ['Slug', <span className="font-mono">{or(form.slug, '…')}</span>],
    ['Chat model', pair(form.chatProvider, form.chatModel)],
    ['Reasoning effort', or(form.reasoningEffort)],
    ['Embedding model', pair(form.embeddingProvider, form.embeddingModel)],
    ['Keys saved for this workspace', keyList.length ? keyList.join(', ') : 'None'],
    ['Chunk size / overlap', `${or(form.chunkSize)} / ${or(form.chunkOverlap)}`],
    ['Top-k / threshold', `${or(form.topK)} / ${or(form.minScore)}`],
    ['System prompt', form.systemPrompt.trim() ? 'Custom' : 'Default'],
  ];
  const fields = Object.keys(problems) as (keyof WizardErrors)[];
  return (
    <>
      <StepIntro title="Review">
        Check what the workspace is created with. Pick a step above to change it.
      </StepIntro>
      <dl className="divide-y rounded-lg border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-4 px-3.5 py-2">
            <dt className="text-muted-foreground w-52 shrink-0">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {fields.length > 0 && (
        <div
          role="alert"
          className="border-destructive/40 space-y-1.5 rounded-lg border px-3.5 py-2.5 text-sm"
        >
          <p className="font-medium">Finish these before creating the workspace:</p>
          <ul className="space-y-1">
            {fields.map((field) => (
              <li key={field} className="flex items-baseline justify-between gap-3">
                <span className="text-destructive">{problems[field]}</span>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => onFix(stepOf(field))}
                >
                  Go to {STEPS[stepOf(field)]}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!system && (
        <p className="text-muted-foreground text-xs">
          The defaults couldn't be read; empty settings use the API's .env.
        </p>
      )}
    </>
  );
}
