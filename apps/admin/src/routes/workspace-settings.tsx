import type { Workspace } from '@rag/shared';
import { Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Field } from '@/components/field';
import { Notice } from '@/components/states';
import { DeleteWorkspaceDialog } from '@/components/delete-workspace-dialog';
import { ReindexDialog } from '@/components/reindex-dialog';
import { TopBar } from '@/components/top-bar';
import { WorkspaceMembers } from '@/components/workspace-members';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSystem } from '@/system/queries';
import { useCurrentWorkspace } from '@/workspaces/current';
import { useUpdateWorkspace } from '@/workspaces/queries';
import {
  chatProviderChoices,
  chatDefaultNote,
  formFor,
  hostedWarning,
  isDirty,
  modelChoices,
  saveErrorMessage,
  validateSettings,
  type SettingsField,
  type SettingsForm,
} from '@/workspaces/settings';

const selectClass =
  'border-input dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-2.5 text-sm shadow-xs';

type Errors = Partial<Record<SettingsField, string>>;

/**
 * `/w/:slug/settings`. Admins only, because that is what the API demands: `PATCH`, `reindex`,
 * `members` and `DELETE` all call `requireWorkspace(..., 'admin')`, and only a global admin is ever
 * `admin` in a workspace. The mock said editors could change these; the API disagrees.
 */
export function WorkspaceSettings() {
  const workspace = useCurrentWorkspace();
  if (workspace.access !== 'admin') {
    return (
      <>
        <TopBar trail={[workspace.name, 'Settings']} />
        <div className="px-6 py-7">
          <Notice
            title="Admins only"
            body="Changing a workspace's name, settings or members needs admin access. Ask an admin to make the change."
            alert
          />
        </div>
      </>
    );
  }
  return <SettingsPage workspace={workspace} />;
}

function SettingsPage({ workspace }: { workspace: Workspace }) {
  // The form is filled once and then owned by the person typing: a refetch (the reindex poll, a
  // mutation elsewhere) must not overwrite what they are in the middle of writing. `loaded` is the
  // workspace it was filled from, and what "changed" is measured against — measuring against the
  // live copy would make someone else's save look like this person's edit and send it back.
  const [loaded, setLoaded] = useState(workspace);
  const [form, setForm] = useState<SettingsForm>(() => formFor(workspace));
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const system = useSystem();
  const save = useUpdateWorkspace(workspace.slug);
  const dirty = isDirty(form, loaded);
  // Pinned on what the field holds now, not on what was saved: a model belongs to the provider it
  // was chosen under, so the one saved for another provider must never be offered under this one.
  const models = modelChoices(system.data, form.chatProvider, form.chatModel);
  const warning = hostedWarning(form.chatProvider);

  const set = (field: SettingsField) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setSaved(false);
  };

  const submit = () => {
    const checked = validateSettings(form, loaded);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    save.mutate(checked.body, {
      // Refilled from what the API stored, so a value it normalised shows as it really is and the
      // form is clean again (which is what disables "Save changes").
      onSuccess: (updated) => {
        setLoaded(updated);
        setForm(formFor(updated));
        setSaved(true);
      },
    });
  };

  return (
    <>
      <TopBar trail={[workspace.name, 'Settings']}>
        <Button size="sm" disabled={!dirty || save.isPending} onClick={submit}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </TopBar>

      <div className="flex w-full max-w-[1160px] flex-col gap-5 px-6 pt-7 pb-12">
        <div>
          <h1 className="text-xl font-semibold">Workspace settings</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Admins can change these. An empty model or retrieval field uses the default from the API's
            environment.
          </p>
        </div>

        {workspace.status === 'reindexing' && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span>
              <strong className="font-medium">Reindexing.</strong> Every document is going through ingestion
              again. Asking, chatting and search are paused for this workspace until the last one finishes.
            </span>
          </div>
        )}

        {save.error && (
          <p role="alert" className="text-destructive text-sm">
            {saveErrorMessage(save.error)}
          </p>
        )}
        {saved && !dirty && (
          <p role="status" className="text-muted-foreground text-sm">
            Settings saved.
          </p>
        )}

        <div className="rounded-xl border">
          <Section
            title="General"
            note="The name and description show in the switcher. The slug is part of every route and can't change."
          >
            <Field id="ws-name" label="Name" error={errors.name}>
              <Input
                id="ws-name"
                aria-describedby="ws-name-note"
                aria-invalid={!!errors.name}
                value={form.name}
                onChange={(e) => set('name')(e.target.value)}
              />
            </Field>
            <Field id="ws-slug" label="Slug" hint="Fixed when the workspace was created.">
              <Input id="ws-slug" className="font-mono text-[13px]" value={workspace.slug} disabled />
            </Field>
            <Field id="ws-description" label="Description" error={errors.description}>
              <Input
                id="ws-description"
                aria-describedby="ws-description-note"
                aria-invalid={!!errors.description}
                value={form.description}
                onChange={(e) => set('description')(e.target.value)}
              />
            </Field>
          </Section>

          <Section
            title="Model and retrieval"
            note="Passed to the Langflow flows for this workspace only. Empty uses the API's own default."
          >
            {system.isError && (
              <p className="text-muted-foreground text-xs" role="status">
                Couldn't read the model providers ({system.error.message}), so the model is a text field and
                the defaults aren't named. Everything still saves.
              </p>
            )}
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field
                id="ws-chat-provider"
                label="Chat provider"
                error={errors.chatProvider}
                hint={chatDefaultNote(system.data)}
              >
                <select
                  id="ws-chat-provider"
                  aria-describedby="ws-chat-provider-note"
                  aria-invalid={!!errors.chatProvider}
                  className={selectClass}
                  value={form.chatProvider}
                  onChange={(e) => {
                    // The model belongs to the provider, so it can't survive the change.
                    setForm((prev) => ({ ...prev, chatProvider: e.target.value, chatModel: '' }));
                    setErrors({});
                    setSaved(false);
                  }}
                >
                  <option value="">Default (from the API's environment)</option>
                  {chatProviderChoices(system.data).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.note ? `${c.id} — ${c.note}` : c.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="ws-chat-model"
                label="Chat model"
                error={errors.chatModel}
                hint={form.chatProvider ? undefined : 'Pick a provider first.'}
              >
                {models.length > 0 ? (
                  <select
                    id="ws-chat-model"
                    aria-describedby="ws-chat-model-note"
                    aria-invalid={!!errors.chatModel}
                    className={selectClass}
                    value={form.chatModel}
                    onChange={(e) => set('chatModel')(e.target.value)}
                  >
                    <option value="">Pick a model…</option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  // The provider didn't answer, or there is no system status: a workspace must not be
                  // locked out of a model just because this page can't list it.
                  <Input
                    id="ws-chat-model"
                    aria-describedby="ws-chat-model-note"
                    aria-invalid={!!errors.chatModel}
                    value={form.chatModel}
                    disabled={!form.chatProvider}
                    placeholder="Model id, as the provider names it"
                    onChange={(e) => set('chatModel')(e.target.value)}
                  />
                )}
              </Field>
            </div>

            {warning && (
              <p
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
              >
                {warning}
              </p>
            )}

            <Field
              id="ws-embedding"
              label="Embedding model"
              hint="Changing this rebuilds every vector, so it changes only through a reindex."
            >
              <Input
                id="ws-embedding"
                value={`${workspace.settings.embeddingProvider} / ${workspace.settings.embeddingModel}`}
                disabled
              />
            </Field>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field
                id="ws-chunk-size"
                label="Chunk size"
                error={errors.chunkSize}
                hint="Characters per passage."
              >
                <NumberInput id="ws-chunk-size" field="chunkSize" form={form} errors={errors} set={set} />
              </Field>
              <Field
                id="ws-chunk-overlap"
                label="Chunk overlap"
                error={errors.chunkOverlap}
                hint="Characters each passage repeats from the one before."
              >
                <NumberInput
                  id="ws-chunk-overlap"
                  field="chunkOverlap"
                  form={form}
                  errors={errors}
                  set={set}
                />
              </Field>
              <Field
                id="ws-topk"
                label="Top-k passages"
                error={errors.topK}
                hint="How many passages an answer may cite."
              >
                <NumberInput id="ws-topk" field="topK" form={form} errors={errors} set={set} />
              </Field>
              <Field
                id="ws-min-score"
                label="Relevance threshold"
                error={errors.minScore}
                hint="Below this, answers say the material doesn't cover it."
              >
                <NumberInput id="ws-min-score" field="minScore" form={form} errors={errors} set={set} />
              </Field>
            </div>

            <Field
              id="ws-system-prompt"
              label="System prompt"
              error={errors.systemPrompt}
              hint="Empty uses the flow's own prompt."
            >
              <textarea
                id="ws-system-prompt"
                aria-describedby="ws-system-prompt-note"
                aria-invalid={!!errors.systemPrompt}
                className="border-input dark:bg-input/30 min-h-21 w-full resize-y rounded-md border bg-transparent px-3 py-2.5 text-sm leading-relaxed shadow-xs"
                value={form.systemPrompt}
                onChange={(e) => set('systemPrompt')(e.target.value)}
              />
            </Field>
          </Section>

          <Section
            title="Reindex"
            note="Changed the chunking, or need another embedding model? A reindex runs every document through the ingest flow again."
          >
            <p className="text-muted-foreground text-sm">
              The workspace's vectors are built from nothing, so asking, chatting and search answer 503 until
              the last document is done.
            </p>
            <div>
              <Button
                variant="outline"
                size="sm"
                // A reindex ingests with the settings the workspace has when it starts, so unsaved
                // chunking would take a second run to apply. Save first, then reindex.
                disabled={workspace.status === 'reindexing' || dirty}
                onClick={() => setReindexing(true)}
              >
                {workspace.status === 'reindexing' ? 'Reindexing…' : 'Reindex workspace'}
              </Button>
              {dirty && workspace.status !== 'reindexing' && (
                <p role="status" className="text-muted-foreground mt-1.5 text-xs">
                  Save your changes first: a reindex ingests with the settings the workspace has when it
                  starts.
                </p>
              )}
            </div>
          </Section>

          <Section
            title="Members"
            note="People sign in through Keycloak; accounts are created there. Here you only grant access to this workspace."
          >
            <WorkspaceMembers workspace={workspace} />
          </Section>

          <Section
            title="Delete workspace"
            note="Removes its documents, files, vectors, conversations and usage history. API keys lose access to it."
          >
            <div>
              <Button variant="destructive" size="sm" onClick={() => setDeleting(true)}>
                Delete workspace…
              </Button>
            </div>
          </Section>
        </div>
      </div>

      {reindexing && (
        <ReindexDialog
          workspace={workspace}
          system={system.data}
          onOpenChange={(open) => setReindexing(open)}
        />
      )}
      {deleting && <DeleteWorkspaceDialog workspace={workspace} onOpenChange={(open) => setDeleting(open)} />}
    </>
  );
}

/** The mock's two-column row: what this group is on the left, its fields on the right. */
function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="flex flex-wrap gap-6 border-b p-6 last:border-b-0">
      <div className="max-w-70 flex-[1_1_220px]">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">{note}</p>
      </div>
      <div className="flex min-w-0 flex-[999_1_400px] flex-col gap-3.5">{children}</div>
    </section>
  );
}

function NumberInput({
  id,
  field,
  form,
  errors,
  set,
}: {
  id: string;
  field: SettingsField;
  form: SettingsForm;
  errors: Errors;
  set(field: SettingsField): (value: string) => void;
}) {
  return (
    <Input
      id={id}
      aria-describedby={`${id}-note`}
      aria-invalid={!!errors[field]}
      inputMode="decimal"
      value={form[field]}
      placeholder="Default"
      onChange={(e) => set(field)(e.target.value)}
    />
  );
}
