import {
  ChatProvider,
  CreateWorkspace,
  EmbeddingProvider,
  WorkspaceSettings,
  type ProviderStatus,
  type SystemStatus,
  type UpdateWorkspace,
  type Workspace,
} from '@rag/shared';
import { ApiError } from '@/api/client';

/**
 * The settings page's state: every field is a string, because that is what an input holds, and an
 * empty one means "use the global default from `.env`" — which is what `null` means to the API.
 */
export interface SettingsForm {
  name: string;
  description: string;
  chatProvider: string;
  chatModel: string;
  systemPrompt: string;
  chunkSize: string;
  chunkOverlap: string;
  topK: string;
  minScore: string;
}
export type SettingsField = keyof SettingsForm;

/** The numbers, and which of them the API wants whole. */
const NUMBERS = {
  chunkSize: { whole: true, schema: WorkspaceSettings.shape.chunkSize },
  chunkOverlap: { whole: true, schema: WorkspaceSettings.shape.chunkOverlap },
  topK: { whole: true, schema: WorkspaceSettings.shape.topK },
  minScore: { whole: false, schema: WorkspaceSettings.shape.minScore },
} as const;
type NumberField = keyof typeof NUMBERS;

const FIELDS: SettingsField[] = [
  'name',
  'description',
  'chatProvider',
  'chatModel',
  'systemPrompt',
  'chunkSize',
  'chunkOverlap',
  'topK',
  'minScore',
];

/** The workspace as the form shows it. A number is rendered the way the input will hand it back. */
export function formFor(w: Workspace): SettingsForm {
  const s = w.settings;
  return {
    name: w.name,
    description: w.description ?? '',
    chatProvider: s.chatProvider ?? '',
    chatModel: s.chatModel ?? '',
    systemPrompt: s.systemPrompt ?? '',
    chunkSize: text(s.chunkSize),
    chunkOverlap: text(s.chunkOverlap),
    topK: text(s.topK),
    minScore: text(s.minScore),
  };
}

const text = (n: number | null) => (n === null ? '' : String(n));

/** Which fields a person has actually changed, so `PATCH` carries nothing else. */
function changedFields(form: SettingsForm, w: Workspace): SettingsField[] {
  const loaded = formFor(w);
  return FIELDS.filter((f) => form[f].trim() !== loaded[f].trim());
}

/** Whether there is anything to save: what the "Save changes" button is enabled by. */
export function isDirty(form: SettingsForm, w: Workspace): boolean {
  return changedFields(form, w).length > 0;
}

export type Validated =
  { ok: true; body: UpdateWorkspace } | { ok: false; errors: Partial<Record<SettingsField, string>> };

/**
 * Checks the form and builds the `PATCH` body from the changed fields only. The embedding provider
 * and model are never in it: `UpdateWorkspace` refuses them, because changing them needs a reindex.
 */
export function validateSettings(form: SettingsForm, w: Workspace): Validated {
  const errors: Partial<Record<SettingsField, string>> = {};
  const changed = changedFields(form, w);

  const name = form.name.trim();
  if (name === '') errors.name = 'Enter a name.';
  else {
    const parsed = CreateWorkspace.shape.name.safeParse(name);
    if (!parsed.success) errors.name = rangeMessage(parsed.error.issues[0]!, 'characters');
  }

  const description = form.description.trim() || null;
  const descriptionCheck = CreateWorkspace.shape.description.safeParse(description);
  if (!descriptionCheck.success) {
    errors.description = rangeMessage(descriptionCheck.error.issues[0]!, 'characters');
  }

  const systemPrompt = form.systemPrompt.trim() || null;
  const promptCheck = WorkspaceSettings.shape.systemPrompt.safeParse(systemPrompt);
  if (!promptCheck.success) errors.systemPrompt = rangeMessage(promptCheck.error.issues[0]!, 'characters');

  // A chat provider and a model resolve separately in the API, so half a pair would answer with one
  // provider and another provider's default model. Both or neither.
  const chatProvider = ChatProvider.safeParse(form.chatProvider).data ?? null;
  const chatModel = form.chatModel.trim() || null;
  if (chatProvider && !chatModel) errors.chatModel = 'Pick a model for this provider.';
  if (!chatProvider && chatModel) errors.chatProvider = 'Pick the provider this model belongs to.';

  const numbers = {} as Record<NumberField, number | null>;
  for (const field of Object.keys(NUMBERS) as NumberField[]) {
    const parsed = parseNumber(form[field], NUMBERS[field]);
    if (typeof parsed === 'string') errors[field] = parsed;
    else numbers[field] = parsed;
  }
  // Overlapping by a whole chunk leaves ingestion with no progress to make. Only comparable when
  // both are set here; an empty field uses a default this page is not told.
  if (!errors.chunkSize && !errors.chunkOverlap && numbers.chunkSize !== null && numbers.chunkOverlap) {
    if (numbers.chunkOverlap >= numbers.chunkSize) {
      errors.chunkOverlap = `Use less than the chunk size (${numbers.chunkSize}).`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const body: UpdateWorkspace = {};
  const settings: NonNullable<UpdateWorkspace['settings']> = {};
  for (const field of changed) {
    switch (field) {
      case 'name':
        body.name = name;
        break;
      case 'description':
        body.description = description;
        break;
      case 'systemPrompt':
        settings.systemPrompt = systemPrompt;
        break;
      case 'chatProvider':
        settings.chatProvider = chatProvider;
        break;
      case 'chatModel':
        settings.chatModel = chatModel;
        break;
      default:
        settings[field] = numbers[field];
    }
  }
  if (Object.keys(settings).length > 0) body.settings = settings;
  return { ok: true, body };
}

type NumberSchema = typeof WorkspaceSettings.shape.chunkSize;

/** `''` is "use the default"; anything else must be a number the API's own range accepts. */
function parseNumber(
  value: string,
  { whole, schema }: { whole: boolean; schema: NumberSchema },
): number | null | string {
  const typed = value.trim();
  if (typed === '') return null;
  const n = Number(typed);
  if (!Number.isFinite(n)) return 'Enter a number.';
  if (whole && !Number.isInteger(n)) return 'Enter a whole number.';
  const parsed = schema.safeParse(n);
  return parsed.success ? n : rangeMessage(parsed.error.issues[0]!, '');
}

interface Issue {
  code: string;
  message: string;
  minimum?: unknown;
  maximum?: unknown;
}

/** zod's "Too big: expected number to be <=50" as something a person reads. */
function rangeMessage(issue: Issue, unit: string): string {
  const suffix = unit ? ` ${unit}` : '';
  if (issue.code === 'too_small') return `Use at least ${String(issue.minimum)}${suffix}.`;
  if (issue.code === 'too_big') return `Use at most ${String(issue.maximum)}${suffix}.`;
  return issue.message;
}

/**
 * The chat providers to offer, each with why it may not work. Without a system status (it is admin
 * only and can fail) every provider the API accepts is offered, so the page is never a dead end.
 */
export function chatProviderChoices(system?: SystemStatus): { id: ChatProvider; note: string }[] {
  if (!system) return ChatProvider.options.map((id) => ({ id, note: '' }));
  return system.providers.map((p) => ({ id: p.id, note: providerNote(p) }));
}

function providerNote(p: ProviderStatus): string {
  if (!p.configured) return 'no API key set';
  if (p.reachable === false) return 'not reachable';
  return '';
}

/**
 * Every model a provider lists right now, in the order it gave them. This is the provider's whole
 * catalogue — chat, embedding, image and speech models alike — because `GET /v1/models` does not say
 * what each one is for, so whoever shows the list has to say the same.
 */
export function providerModels(system: SystemStatus | undefined, provider: string): string[] {
  if (!system || !provider) return [];
  return system.providers.find((p) => p.id === provider)?.models ?? [];
}

/**
 * The models to offer for the chat provider now chosen, with the model the form already holds first
 * even when the provider does not list it: a model typed while the system status was unavailable,
 * or one the provider has stopped serving, must not vanish from the field that holds it.
 * Empty when there is nothing to list, and the page asks for the model as text instead.
 */
export function modelChoices(system: SystemStatus | undefined, provider: string, current: string): string[] {
  const listed = providerModels(system, provider);
  if (listed.length === 0) return [];
  const pinned = current.trim();
  return pinned && !listed.includes(pinned) ? [pinned, ...listed] : listed;
}

/** Hosted providers answer from someone else's machine; the page says so beside the picker. */
export function hostedWarning(provider: string): string | null {
  if (provider === '' || provider === 'lmstudio') return null;
  return `Questions and the passages retrieved to answer them are sent to ${provider}, so this workspace's material leaves this machine.`;
}

/**
 * The same warning for an embedding provider, which is a bigger exposure and deserves its own
 * words: embedding sends the text of *every* document, not the handful of passages a question
 * retrieves.
 */
export function hostedEmbeddingWarning(provider: string): string | null {
  if (provider === 'lmstudio') return null;
  return `Every document in this workspace is sent to ${provider} to be embedded, so its full text — not just the passages a question retrieves — leaves this machine.`;
}

const canEmbed = (p: ProviderStatus): p is ProviderStatus & { id: EmbeddingProvider } =>
  (EmbeddingProvider.options as readonly string[]).includes(p.id);

/**
 * The embedding providers a reindex could switch to: the one in use first, then the others that are
 * configured, answered and can embed. Without a system status every provider the API accepts is
 * offered, so a failed (admin-only) status call never leaves the model unchangeable.
 */
export function embeddingProviderChoices(
  system: SystemStatus | undefined,
  current: EmbeddingProvider,
): EmbeddingProvider[] {
  const others: readonly EmbeddingProvider[] = system
    ? system.providers
        .filter(canEmbed)
        .flatMap((p) => (p.configured && p.reachable && p.embeddings ? [p.id] : []))
    : EmbeddingProvider.options;
  return [current, ...others.filter((id) => id !== current)];
}

/** What an empty chat model field will fall back to, for the hint under it. */
export function chatDefaultNote(system?: SystemStatus): string {
  if (!system) return '';
  const d = system.defaults.chat;
  return `Default: ${d.provider} / ${d.model}${d.available ? '' : ' (not available right now)'}`;
}

/** The API's answer to `PATCH /v1/workspaces/{slug}`, in words. */
export function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    return 'Only admins can change a workspace’s settings.';
  }
  if (err instanceof ApiError && (err.status === 400 || err.status === 422)) return err.message;
  const cause = err instanceof Error ? err.message : String(err);
  return `Couldn't save the settings: ${cause}`;
}

/** The API's answer to `POST /v1/workspaces/{slug}/reindex`, in words. */
export function reindexErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'Only admins can reindex a workspace.';
  if (err instanceof ApiError && (err.status === 409 || err.status === 422)) return err.message;
  const cause = err instanceof Error ? err.message : String(err);
  return `Couldn't start the reindex: ${cause}`;
}
