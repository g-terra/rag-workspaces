import type { SystemStatus } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { buildCreate, emptyWizard, missingKeys, modelsFor, stepOf, type WizardForm } from './wizard';

const form = (over: Partial<WizardForm> = {}): WizardForm => ({
  ...emptyWizard(),
  name: 'Thesis research',
  slug: 'thesis',
  ...over,
});

const system = {
  providers: [
    {
      id: 'lmstudio',
      configured: true,
      reachable: true,
      error: null,
      models: ['qwen', 'nomic-embed'],
      embeddings: true,
    },
    { id: 'openai', configured: true, reachable: true, error: null, models: ['gpt-x'], embeddings: true },
    {
      id: 'gemini',
      configured: false,
      reachable: null,
      error: 'GEMINI_API_KEY is not set',
      models: [],
      embeddings: true,
    },
    { id: 'anthropic', configured: false, reachable: null, error: 'x', models: [], embeddings: false },
  ],
} as unknown as SystemStatus;

describe('buildCreate', () => {
  it('with only the basics, sends no settings, so every one is the default', () => {
    expect(buildCreate(form(), {}, system)).toEqual({
      ok: true,
      body: { slug: 'thesis', name: 'Thesis research', description: null },
      keys: [],
    });
  });

  it('sends the models and retrieval settings that were filled in, and nothing else', () => {
    const result = buildCreate(
      form({
        chatProvider: 'gemini',
        chatModel: 'gemini-2.5-flash',
        embeddingProvider: 'lmstudio',
        embeddingModel: 'nomic-embed',
        topK: '6',
        systemPrompt: 'Answer briefly.',
      }),
      { gemini: 'gem-key-000000000000000', anthropic: 'unused-key-0000000000000' },
      system,
    );
    expect(result).toEqual({
      ok: true,
      body: {
        slug: 'thesis',
        name: 'Thesis research',
        description: null,
        settings: {
          chatProvider: 'gemini',
          chatModel: 'gemini-2.5-flash',
          embeddingProvider: 'lmstudio',
          embeddingModel: 'nomic-embed',
          topK: 6,
          systemPrompt: 'Answer briefly.',
        },
      },
      // Only keys for providers the workspace uses are saved.
      keys: [{ provider: 'gemini', apiKey: 'gem-key-000000000000000' }],
    });
  });

  it('points at the step that holds the first problem', () => {
    const bad = buildCreate(form({ slug: '', chunkSize: 'lots' }), {}, system);
    expect(bad).toMatchObject({
      ok: false,
      step: 0,
      errors: { slug: 'Enter a slug.', chunkSize: 'Enter a number.' },
    });
    const retrieval = buildCreate(form({ chunkSize: 'lots' }), {}, system);
    expect(retrieval).toMatchObject({ ok: false, step: 2 });
  });

  it('wants a provider and a model together, for chat and for embedding', () => {
    expect(buildCreate(form({ embeddingProvider: 'openai' }), {}, system)).toMatchObject({
      ok: false,
      step: 1,
      errors: { embeddingModel: 'Pick a model for this provider.' },
    });
    expect(buildCreate(form({ chatModel: 'gpt-x' }), {}, system)).toMatchObject({
      ok: false,
      errors: { chatProvider: 'Pick the provider this model belongs to.' },
    });
  });

  it('refuses a hosted provider with no key anywhere', () => {
    expect(
      buildCreate(form({ chatProvider: 'gemini', chatModel: 'gemini-2.5-flash' }), {}, system),
    ).toMatchObject({
      ok: false,
      step: 1,
      errors: { keys: 'Add a key for gemini, or pick another provider.' },
    });
  });
});

describe('missingKeys', () => {
  it('lists the hosted providers in use with no key in .env and none typed', () => {
    const f = form({ chatProvider: 'anthropic', embeddingProvider: 'gemini' });
    expect(missingKeys(f, system, {})).toEqual(['anthropic', 'gemini']);
    expect(missingKeys(f, system, { gemini: 'k' })).toEqual(['anthropic']);
    expect(missingKeys(form({ chatProvider: 'openai' }), system, {})).toEqual([]);
  });

  it('asks for nothing when the system status is unknown', () => {
    expect(missingKeys(form({ chatProvider: 'gemini' }), undefined, {})).toEqual([]);
  });
});

describe('modelsFor', () => {
  it('prefers the models listed with a typed key over the system’s list', () => {
    expect(modelsFor('gemini', system, { gemini: ['gemini-2.5-flash'] })).toEqual(['gemini-2.5-flash']);
    expect(modelsFor('openai', system, {})).toEqual(['gpt-x']);
    expect(modelsFor('', system, {})).toEqual([]);
  });
});

it('maps each field to its step', () => {
  expect([stepOf('name'), stepOf('chatModel'), stepOf('keys'), stepOf('minScore')]).toEqual([0, 1, 1, 2]);
});
