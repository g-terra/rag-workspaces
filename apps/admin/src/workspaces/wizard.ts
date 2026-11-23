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

export const STEPS = ['Basics', 'Models', 'Retrieval', 'Review'] as const;

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

type ErrorField = keyof WizardForm | 'keys';
export type WizardErrors = Partial<Record<ErrorField, string>>;

const STEP_OF: Record<ErrorField, number> = {
  name: 0,
  slug: 0,
  description: 0,
  chatProvider: 1,
  chatModel: 1,
  embeddingProvider: 1,
  embeddingModel: 1,
  keys: 1,
  reasoningEffort: 1,
  systemPrompt: 2,
  chunkSize: 2,
  chunkOverlap: 2,
  topK: 2,
  minScore: 2,
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
 * The hosted providers the form uses that have no key: none in `.env` (the system status says so)
 * and none typed here. Without a system status nothing is known, so nothing is asked for.
 */
export function missingKeys(
  form: WizardForm,
  system: SystemStatus | undefined,
  keys: TypedKeys,
): HostedProvider[] {
  if (!system) return [];
  return chosenHosted(form).filter(
    (id) => !keys[id] && !system.providers.find((p) => p.id === id)?.configured,
  );
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

  const missing = missingKeys(form, system, keys);
  if (missing.length > 0) errors.keys = `Add a key for ${missing.join(' and ')}, or pick another provider.`;

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
