import type { SystemStatus, Workspace } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import {
  chatDefaultNote,
  chatModelDefault,
  defaultPlaceholder,
  chatProviderChoices,
  embeddingProviderChoices,
  formFor,
  hostedEmbeddingWarning,
  hostedWarning,
  isDirty,
  modelChoices,
  providerModels,
  reindexErrorMessage,
  saveErrorMessage,
  validateSettings,
} from './settings';

const workspace = (over: Partial<Workspace> = {}): Workspace => ({
  id: 'w1',
  slug: 'ouc',
  name: 'OUC study material',
  description: 'MSc modules',
  status: 'active',
  access: 'admin',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  settings: {
    chatProvider: null,
    chatModel: null,
    embeddingProvider: 'lmstudio',
    embeddingModel: 'embed-small',
    embeddingPrefixes: null,
    systemPrompt: null,
    chunkSize: 800,
    chunkOverlap: 100,
    topK: 5,
    minScore: 0.35,
    ...over.settings,
  },
  ...over,
});

const provider = (over: Partial<SystemStatus['providers'][number]>): SystemStatus['providers'][number] => ({
  id: 'lmstudio',
  configured: true,
  reachable: true,
  error: null,
  models: [],
  embeddings: true,
  ...over,
});

const system = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  version: '0.1.0',
  status: 'ok',
  langflowKey: 'auto',
  services: [],
  providers: [
    provider({ id: 'lmstudio', models: ['local-a', 'local-b'] }),
    provider({ id: 'openai', models: ['hosted-a'] }),
    provider({ id: 'gemini', configured: false, reachable: null, models: [] }),
    provider({ id: 'anthropic', models: ['hosted-b'], embeddings: false }),
  ],
  defaults: {
    chat: { provider: 'lmstudio', model: 'local-a', available: true },
    embedding: { provider: 'lmstudio', model: 'embed-small', available: true },
    workspace: { chunkSize: 800, chunkOverlap: 100, topK: 5, minScore: 0.3, systemPrompt: 'Cite as [n].' },
  },
  ...over,
});

describe('formFor', () => {
  it('shows a setting left to the global default as an empty field', () => {
    const form = formFor(workspace());
    expect(form.chatProvider).toBe('');
    expect(form.chatModel).toBe('');
    expect(form.systemPrompt).toBe('');
  });

  it('fills the fields the workspace has set', () => {
    const form = formFor(
      workspace({ settings: { ...workspace().settings, chatProvider: 'openai', chatModel: 'hosted-a' } }),
    );
    expect(form).toMatchObject({
      name: 'OUC study material',
      description: 'MSc modules',
      chatProvider: 'openai',
      chatModel: 'hosted-a',
      chunkSize: '800',
      chunkOverlap: '100',
      topK: '5',
      minScore: '0.35',
    });
  });
});

describe('isDirty', () => {
  it('is false for the form the workspace was loaded into', () => {
    expect(isDirty(formFor(workspace()), workspace())).toBe(false);
  });

  it('is true once a field changes', () => {
    expect(isDirty({ ...formFor(workspace()), topK: '8' }, workspace())).toBe(true);
  });

  it('ignores whitespace a person leaves around a name', () => {
    expect(isDirty({ ...formFor(workspace()), name: '  OUC study material  ' }, workspace())).toBe(false);
  });
});

describe('validateSettings', () => {
  const ok = (form: ReturnType<typeof formFor>, w = workspace()) => {
    const result = validateSettings(form, w);
    if (!result.ok) throw new Error(`expected valid, got ${JSON.stringify(result.errors)}`);
    return result.body;
  };
  const errors = (form: ReturnType<typeof formFor>, w = workspace()) => {
    const result = validateSettings(form, w);
    if (result.ok) throw new Error('expected errors');
    return result.errors;
  };

  it('sends only what changed', () => {
    expect(ok({ ...formFor(workspace()), name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('sends an emptied description as null, not as an empty string', () => {
    expect(ok({ ...formFor(workspace()), description: '  ' })).toEqual({ description: null });
  });

  it('sends an emptied number as null, so the workspace goes back to the global default', () => {
    expect(ok({ ...formFor(workspace()), topK: '' })).toEqual({ settings: { topK: null } });
  });

  it('sends a changed number as a number', () => {
    expect(ok({ ...formFor(workspace()), minScore: '0.5' })).toEqual({ settings: { minScore: 0.5 } });
  });

  it('never sends the embedding provider or model, which PATCH refuses', () => {
    const body = ok({ ...formFor(workspace()), chunkSize: '900' });
    expect(JSON.stringify(body)).not.toContain('embedding');
  });

  it('sends the chat provider and model together', () => {
    expect(ok({ ...formFor(workspace()), chatProvider: 'openai', chatModel: 'hosted-a' })).toEqual({
      settings: { chatProvider: 'openai', chatModel: 'hosted-a' },
    });
  });

  it('clears both when the provider goes back to the default', () => {
    const w = workspace({
      settings: { ...workspace().settings, chatProvider: 'openai', chatModel: 'hosted-a' },
    });
    expect(ok({ ...formFor(w), chatProvider: '', chatModel: '' }, w)).toEqual({
      settings: { chatProvider: null, chatModel: null },
    });
  });

  it('refuses a provider with no model, which would answer with another provider’s default', () => {
    expect(errors({ ...formFor(workspace()), chatProvider: 'openai' })).toEqual({
      chatModel: 'Pick a model for this provider.',
    });
  });

  it('refuses a model with no provider, for the same reason', () => {
    expect(errors({ ...formFor(workspace()), chatModel: 'hosted-a' })).toEqual({
      chatProvider: 'Pick the provider this model belongs to.',
    });
  });

  it('refuses an overlap that is not smaller than the chunk size', () => {
    expect(errors({ ...formFor(workspace()), chunkSize: '400', chunkOverlap: '400' })).toEqual({
      chunkOverlap: 'Use less than the chunk size (400).',
    });
  });

  it('allows an overlap it cannot compare, because the chunk size uses the default', () => {
    expect(ok({ ...formFor(workspace()), chunkSize: '', chunkOverlap: '400' })).toEqual({
      settings: { chunkSize: null, chunkOverlap: 400 },
    });
  });

  it('says what a number may be, in words', () => {
    expect(errors({ ...formFor(workspace()), topK: '99' })).toEqual({ topK: 'Use at most 50.' });
    expect(errors({ ...formFor(workspace()), minScore: '2' })).toEqual({ minScore: 'Use at most 1.' });
    expect(errors({ ...formFor(workspace()), chunkSize: '10' })).toEqual({ chunkSize: 'Use at least 100.' });
  });

  it('refuses a number that is not one', () => {
    expect(errors({ ...formFor(workspace()), topK: 'five' })).toEqual({ topK: 'Enter a number.' });
  });

  it('refuses a whole number given as a fraction', () => {
    expect(errors({ ...formFor(workspace()), topK: '4.5' })).toEqual({ topK: 'Enter a whole number.' });
  });

  it('refuses an empty name', () => {
    expect(errors({ ...formFor(workspace()), name: '   ' })).toEqual({ name: 'Enter a name.' });
  });

  it('reports nothing to save when the form matches the workspace', () => {
    const result = validateSettings(formFor(workspace()), workspace());
    expect(result).toEqual({ ok: true, body: {} });
  });
});

describe('chatProviderChoices', () => {
  it('says which providers have no key set and which did not answer', () => {
    const choices = chatProviderChoices(
      system({
        providers: [
          provider({ id: 'lmstudio', reachable: false, error: 'connection refused' }),
          provider({ id: 'openai' }),
          provider({ id: 'gemini', configured: false, reachable: null }),
          provider({ id: 'anthropic' }),
        ],
      }),
    );
    expect(choices).toEqual([
      { id: 'lmstudio', note: 'not reachable' },
      { id: 'openai', note: '' },
      { id: 'gemini', note: 'no API key set' },
      { id: 'anthropic', note: '' },
    ]);
  });

  it('offers every provider the API accepts when the system status could not be read', () => {
    expect(chatProviderChoices(undefined).map((c) => c.id)).toEqual([
      'lmstudio',
      'openai',
      'anthropic',
      'gemini',
    ]);
  });
});

describe('providerModels', () => {
  it('gives the provider’s whole catalogue, which is all the API knows about it', () => {
    expect(providerModels(system(), 'openai')).toEqual(['hosted-a']);
  });

  it('gives nothing without a provider or a system status', () => {
    expect(providerModels(system(), '')).toEqual([]);
    expect(providerModels(undefined, 'openai')).toEqual([]);
  });
});

describe('modelChoices', () => {
  it('lists the models the provider offers', () => {
    expect(modelChoices(system(), 'lmstudio', '')).toEqual(['local-a', 'local-b']);
  });

  it('keeps the model the form already holds even when the provider does not list it', () => {
    expect(modelChoices(system(), 'lmstudio', 'retired-model')).toEqual([
      'retired-model',
      'local-a',
      'local-b',
    ]);
  });

  it('has nothing to offer for a provider that did not answer, so the page falls back to typing', () => {
    const down = system({ providers: [provider({ id: 'lmstudio', reachable: false, models: [] })] });
    expect(modelChoices(down, 'lmstudio', '')).toEqual([]);
  });

  it('has nothing to offer without a provider or without a system status', () => {
    expect(modelChoices(system(), '', '')).toEqual([]);
    expect(modelChoices(undefined, 'lmstudio', '')).toEqual([]);
  });
});

describe('hostedWarning', () => {
  it('warns that a hosted provider receives this workspace’s questions and passages', () => {
    expect(hostedWarning('openai')).toContain('leaves this machine');
    expect(hostedWarning('anthropic')).toContain('leaves this machine');
    expect(hostedWarning('gemini')).toContain('leaves this machine');
  });

  it('says nothing for a model that runs locally, or for the global default', () => {
    expect(hostedWarning('lmstudio')).toBeNull();
    expect(hostedWarning('')).toBeNull();
  });
});

describe('hostedEmbeddingWarning', () => {
  it('says the whole corpus leaves the machine, which is more than the chat warning', () => {
    expect(hostedEmbeddingWarning('openai')).toContain('Every document');
    expect(hostedEmbeddingWarning('openai')).toContain('leaves this machine');
  });

  it('says nothing for the local provider', () => {
    expect(hostedEmbeddingWarning('lmstudio')).toBeNull();
  });
});

describe('embeddingProviderChoices', () => {
  it('offers the one in use first, then those configured, answering, and able to embed', () => {
    expect(embeddingProviderChoices(system(), 'lmstudio')).toEqual(['lmstudio', 'openai']);
  });

  it('never leaves out the provider in use, even when it stopped answering', () => {
    const down = system({ providers: [provider({ id: 'lmstudio', reachable: false, models: [] })] });
    expect(embeddingProviderChoices(down, 'lmstudio')).toEqual(['lmstudio']);
  });

  it('offers every provider the API accepts when the system status could not be read', () => {
    expect(embeddingProviderChoices(undefined, 'openai')).toEqual(['openai', 'lmstudio', 'gemini']);
  });
});

describe('chatDefaultNote', () => {
  it('names the default from .env, so an empty field says what it will use', () => {
    expect(chatDefaultNote(system())).toBe('Default: lmstudio / local-a');
  });

  it('marks a default its provider cannot serve right now', () => {
    const broken = system({
      defaults: {
        chat: { provider: 'openai', model: 'hosted-a', available: false },
        embedding: { provider: 'lmstudio', model: 'embed-small', available: true },
        workspace: {
          chunkSize: 800,
          chunkOverlap: 100,
          topK: 5,
          minScore: 0.3,
          systemPrompt: 'Cite as [n].',
        },
      },
    });
    expect(chatDefaultNote(broken)).toBe('Default: openai / hosted-a (not available right now)');
  });

  it('says nothing it cannot know', () => {
    expect(chatDefaultNote(undefined)).toBe('');
  });
});

describe('defaultPlaceholder', () => {
  it('shows the value an empty field falls back to', () => {
    expect(defaultPlaceholder(system(), 'chunkSize')).toBe('Default: 800');
    expect(defaultPlaceholder(system(), 'chunkOverlap')).toBe('Default: 100');
    expect(defaultPlaceholder(system(), 'topK')).toBe('Default: 5');
    expect(defaultPlaceholder(system(), 'minScore')).toBe('Default: 0.3');
    expect(defaultPlaceholder(system(), 'systemPrompt')).toBe('Default: Cite as [n].');
  });

  it('falls back to a plain "Default" without a system status', () => {
    expect(defaultPlaceholder(undefined, 'topK')).toBe('Default');
  });
});

describe('chatModelDefault', () => {
  it('names the default model while the provider is left to the default', () => {
    expect(chatModelDefault(system(), '')).toBe('Default: local-a');
  });

  it('says nothing once a provider is picked, or without a system status', () => {
    expect(chatModelDefault(system(), 'openai')).toBeNull();
    expect(chatModelDefault(undefined, '')).toBeNull();
  });
});

describe('saveErrorMessage', () => {
  it('passes the API’s own words through for a body it refused', () => {
    expect(saveErrorMessage(new ApiError(400, 'chunkSize: too big'))).toBe('chunkSize: too big');
  });

  it('explains a 403 in terms of who may change settings', () => {
    expect(saveErrorMessage(new ApiError(403, 'forbidden'))).toContain('admins');
  });

  it('names the cause for anything else', () => {
    expect(saveErrorMessage(new ApiError(503, 'Chroma is down'))).toBe(
      "Couldn't save the settings: Chroma is down",
    );
  });
});

describe('reindexErrorMessage', () => {
  it('explains a reindex that is already running', () => {
    expect(reindexErrorMessage(new ApiError(409, 'already'))).toContain('already');
  });

  it('explains a provider whose key is not set', () => {
    expect(reindexErrorMessage(new ApiError(422, 'OPENAI_API_KEY is not set'))).toContain(
      'OPENAI_API_KEY is not set',
    );
  });

  it('falls back to the cause', () => {
    expect(reindexErrorMessage(new Error('offline'))).toBe("Couldn't start the reindex: offline");
  });
});
