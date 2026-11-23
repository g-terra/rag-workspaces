import {
  EmbeddingProvider,
  HostedProvider,
  type CreateWorkspace,
  type SystemStatus,
  type Workspace,
} from '@rag/shared';
import { validateCreate } from './create';
import { validateSettings, type SettingsForm } from './settings';

/** Everything the create-workspace wizard asks for, as text (empty means the `.env` default). */
export interface WizardForm extends SettingsForm {
  slug: string;
  embeddingProvider: string;
  embeddingModel: string;
}

export const STEPS = ['Basics', 'Chat', 'Embeddings', 'Retrieval', 'Review'] as const;

/** The last step, where the workspace is created. */
export const REVIEW = STEPS.length - 1;

/** Keys typed in the wizard, by provider; held in memory until the workspace exists. */
export type TypedKeys = Partial<Record<HostedProvider, string>>;

export function emptyWizard(): WizardForm {
  return {
    name: '',
    slug: '',
    description: '',
    chatProvider: '',
    chatModel: '',
    embeddingProvider: '',
    embeddingModel: '',
    systemPrompt: '',
    chunkSize: '',
    chunkOverlap: '',
    topK: '',
    minScore: '',
    reasoningEffort: '',
  };
}

type ErrorField = keyof WizardForm | 'chatKey' | 'embeddingKey';
export type WizardErrors = Partial<Record<ErrorField, string>>;

const STEP_OF: Record<ErrorField, number> = {
  name: 0,
  slug: 0,
  description: 0,
  chatProvider: 1,
  chatModel: 1,
  chatKey: 1,
  reasoningEffort: 1,
  embeddingProvider: 2,
  embeddingModel: 2,
  embeddingKey: 2,
  systemPrompt: 3,
  chunkSize: 3,
  chunkOverlap: 3,
  topK: 3,
  minScore: 3,
};

/** The step that shows a field, so a failed create can open the step with the problem. */
export function stepOf(field: ErrorField): number {
  return STEP_OF[field];
}

const isHosted = (id: string): id is HostedProvider =>
  (HostedProvider.options as readonly string[]).includes(id);

/** The hosted providers the form uses (chat or embedding), in that order, each once. */
function chosenHosted(form: WizardForm): HostedProvider[] {
  return [...new Set([form.chatProvider, form.embeddingProvider])].filter(isHosted);
}

/**
 * Whether a provider still needs a key typed and checked here: it is hosted, `.env` has none for it
 * (the system status says so), and none was checked in this wizard. A key checked for one step counts
 * for the other, so Gemini for chat and for embeddings asks once. Without a system status nothing is
 * known, so nothing is asked for.
 */
export function needsKey(provider: string, system: SystemStatus | undefined, keys: TypedKeys): boolean {
  if (!system || !isHosted(provider) || keys[provider]) return false;
  return !system.providers.find((p) => p.id === provider)?.configured;
}

/** A provider's models: those listed when its typed key was checked, else the system's list. */
export function modelsFor(
  provider: string,
  system: SystemStatus | undefined,
  checked: Partial<Record<HostedProvider, string[]>>,
): string[] {
  if (!provider) return [];
  if (isHosted(provider) && checked[provider]) return checked[provider];
  return system?.providers.find((p) => p.id === provider)?.models ?? [];
}

/**
 * A workspace with every setting empty, to measure the form against: `validateSettings` sends only
 * what differs from it, which here is what was filled in.
 */
const BLANK: Workspace = {
  id: '',
  slug: '',
  name: '',
  description: null,
  status: 'active',
  access: 'admin',
  createdAt: '',
  updatedAt: '',
  settings: {
    chatProvider: null,
    chatModel: null,
    embeddingProvider: 'lmstudio',
    embeddingModel: '',
    embeddingPrefixes: null,
    systemPrompt: null,
    chunkSize: null,
    chunkOverlap: null,
    topK: null,
    minScore: null,
    reasoningEffort: null,
    style: null,
  },
};

export type Built =
  | { ok: true; body: CreateWorkspace; keys: { provider: HostedProvider; apiKey: string }[] }
  | { ok: false; errors: WizardErrors; step: number };

/**
 * Checks the whole wizard and builds `POST /v1/workspaces`, plus the keys to save once the workspace
 * exists (only for providers it uses). Fields left empty are not sent, so they keep the defaults.
 */
export function buildCreate(form: WizardForm, keys: TypedKeys, system: SystemStatus | undefined): Built {
  const errors: WizardErrors = {};

  const basics = validateCreate({ name: form.name, slug: form.slug, description: form.description });
  if (!basics.ok) Object.assign(errors, basics.errors);

  const settings = validateSettings({ ...form, name: form.name || 'x', description: '' }, BLANK);
  if (!settings.ok) Object.assign(errors, settings.errors);

  const embeddingProvider = EmbeddingProvider.safeParse(form.embeddingProvider).data;
  const embeddingModel = form.embeddingModel.trim();
  if (embeddingProvider && !embeddingModel) errors.embeddingModel = 'Pick a model for this provider.';
  if (!embeddingProvider && embeddingModel)
    errors.embeddingProvider = 'Pick the provider this model belongs to.';

  const keyNeeded = (provider: string) => `Add a ${provider} key and check it, or pick another provider.`;
  if (needsKey(form.chatProvider, system, keys)) errors.chatKey = keyNeeded(form.chatProvider);
  if (needsKey(form.embeddingProvider, system, keys)) errors.embeddingKey = keyNeeded(form.embeddingProvider);

  const fields = Object.keys(errors) as ErrorField[];
  if (!basics.ok || !settings.ok || fields.length > 0) {
    return { ok: false, errors, step: Math.min(...fields.map(stepOf)) };
  }

  const chosen = { ...settings.body.settings };
  if (embeddingProvider) Object.assign(chosen, { embeddingProvider, embeddingModel });
  const body: CreateWorkspace = { ...basics.body };
  if (Object.keys(chosen).length > 0) body.settings = chosen;
  const saved = chosenHosted(form).flatMap((provider) => {
    const apiKey = keys[provider]?.trim();
    return apiKey ? [{ provider, apiKey }] : [];
  });
  return { ok: true, body, keys: saved };
}

/**
 * What keeps the wizard on a step: that step's own problems, so Next waits until it is complete. On
 * the review step, every problem, because that is where the workspace is created.
 */
export function stepErrors(
  step: number,
  form: WizardForm,
  keys: TypedKeys,
  system: SystemStatus | undefined,
): WizardErrors {
  const built = buildCreate(form, keys, system);
  if (built.ok) return {};
  if (step === REVIEW) return built.errors;
  return Object.fromEntries(
    Object.entries(built.errors).filter(([field]) => stepOf(field as ErrorField) === step),
  ) as WizardErrors;
}
