import { splitModels } from './env-file.ts';

export type Provider = 'lmstudio' | 'openai' | 'gemini' | 'anthropic';
export type ModelKind = 'chat' | 'embedding';

export const CUSTOM_MODEL = '__custom__';

interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

const PROVIDERS: SelectOption<Provider>[] = [
  { value: 'lmstudio', label: 'LM Studio', hint: 'local on this machine, offline, no key' },
  { value: 'openai', label: 'OpenAI', hint: 'hosted, requires OPENAI_API_KEY' },
  { value: 'gemini', label: 'Google Gemini', hint: 'hosted, requires GEMINI_API_KEY' },
  { value: 'anthropic', label: 'Anthropic', hint: 'hosted chat only, requires ANTHROPIC_API_KEY' },
];

/** Provider choices for an interactive select prompt. Anthropic has no embedding models. */
export function providerOptions(kind: ModelKind): SelectOption<Provider>[] {
  return kind === 'embedding' ? PROVIDERS.filter((p) => p.value !== 'anthropic') : [...PROVIDERS];
}

/**
 * Build arrow-key select options for a provider's models, prioritising the current or suggested
 * model and appending a custom-entry option. Returns `null` when no models are available so the
 * caller can prompt directly with a text input.
 */
export function modelOptions(
  kind: ModelKind,
  provider: Provider,
  models: string[],
  current: string,
  suggested?: string,
): { options: SelectOption[]; initialValue: string } | null {
  const unique = [...new Set(models)];
  if (unique.length === 0) return null;

  const split = splitModels(unique)[kind];
  // For LM Studio, only show models matching the kind; for hosted providers, fall back to the full
  // list if none match the `/embed/i` heuristic.
  const pool = provider === 'lmstudio' ? split : split.length > 0 ? split : unique;
  if (pool.length === 0) return null;

  const pinned: string[] = [];
  if (current && pool.includes(current)) pinned.push(current);
  if (suggested && suggested !== current && pool.includes(suggested)) pinned.push(suggested);

  const rest = pool.filter((id) => !pinned.includes(id)).sort((a, b) => a.localeCompare(b));
  const ordered = [...pinned, ...rest];

  const options: SelectOption[] = ordered.map((id) => {
    const hint = id === current ? 'current' : id === suggested ? 'recommended' : undefined;
    return hint ? { value: id, label: id, hint } : { value: id, label: id };
  });
  options.push({ value: CUSTOM_MODEL, label: 'Enter a custom model id…', hint: 'type any id' });

  return { options, initialValue: ordered[0]! };
}

export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

/** Whisper sizes for the transcription prompt: what each downloads and roughly needs in memory. */
export function whisperModelOptions(): SelectOption<WhisperModel>[] {
  return [
    { value: 'tiny', label: 'tiny', hint: '75 MB download, ~1 GB RAM, quickest and roughest' },
    { value: 'base', label: 'base', hint: '150 MB download, ~1 GB RAM, the default' },
    { value: 'small', label: 'small', hint: '500 MB download, ~2 GB RAM, clearly better for lectures' },
    { value: 'medium', label: 'medium', hint: '1.5 GB download, ~5 GB RAM, slow on a CPU' },
    { value: 'large-v3', label: 'large-v3', hint: '3 GB download, ~10 GB RAM, very slow on a CPU' },
  ];
}

const WHISPER_URL = 'http://whisper:9000';

/**
 * The .env values that turn video and audio transcription on or off. It is the compose `video`
 * profile (the whisper service) plus `WHISPER_URL` for the API; other profiles are kept. Turning it
 * off leaves `WHISPER_MODEL` alone, so turning it back on offers the same size.
 */
export function transcriptionEnv(on: boolean, model: string, profiles: string): Record<string, string> {
  const list = profiles
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!on) return { COMPOSE_PROFILES: list.filter((s) => s !== 'video').join(','), WHISPER_URL: '' };
  const withVideo = list.includes('video') ? list : [...list, 'video'];
  return { COMPOSE_PROFILES: withVideo.join(','), WHISPER_URL, WHISPER_MODEL: model };
}

/**
 * Validation for a typed model id. The prompt validates the raw answer before it falls back to its
 * default, so an empty answer is fine whenever there is a default to take.
 */
export function modelIdError(value: string | undefined, fallback: string): string | undefined {
  return !value?.trim() && !fallback ? 'A model id is required.' : undefined;
}
