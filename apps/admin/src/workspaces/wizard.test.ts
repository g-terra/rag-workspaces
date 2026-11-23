import type { SystemStatus } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { buildCreate, emptyWizard, modelsFor, needsKey, stepErrors, stepOf, type WizardForm } from './wizard';

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

const GEMINI_KEY = 'gem-key-000000000000000';

describe('buildCreate', () => {
  it('with every choice left on its default, sends no settings', () => {
    expect(buildCreate(form(), {}, system)).toEqual({
      ok: true,
      body: { slug: 'thesis', name: 'Thesis research', description: null },
      keys: [],
    });
  });

  it('sends the models and retrieval settings that were chosen, and nothing else', () => {
    const result = buildCreate(
      form({
        chatProvider: 'gemini',
        chatModel: 'gemini-2.5-flash',
        embeddingProvider: 'lmstudio',
        embeddingModel: 'nomic-embed',
        topK: '6',
        systemPrompt: 'Answer briefly.',
      }),
      { gemini: GEMINI_KEY, anthropic: 'unused-key-0000000000000' },
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
      keys: [{ provider: 'gemini', apiKey: GEMINI_KEY }],
    });
  });

  it('points at the step that holds the first problem', () => {
    const bad = buildCreate(form({ slug: '', chunkSize: 'lots' }), {}, system);
    expect(bad).toMatchObject({
      ok: false,
      step: 0,
      errors: { slug: 'Enter a slug.', chunkSize: 'Enter a number.' },
    });
    expect(buildCreate(form({ chunkSize: 'lots' }), {}, system)).toMatchObject({ ok: false, step: 3 });
  });

  it('wants a provider and a model together, for chat and for embeddings', () => {
    expect(buildCreate(form({ embeddingProvider: 'openai' }), {}, system)).toMatchObject({
      ok: false,
      step: 2,
      errors: { embeddingModel: 'Pick a model for this provider.' },
    });
    expect(buildCreate(form({ chatModel: 'gpt-x' }), {}, system)).toMatchObject({
      ok: false,
      step: 1,
      errors: { chatProvider: 'Pick the provider this model belongs to.' },
    });
  });

  it('refuses a hosted provider with no key anywhere, on the step that chose it', () => {
    expect(
      buildCreate(form({ chatProvider: 'gemini', chatModel: 'gemini-2.5-flash' }), {}, system),
    ).toMatchObject({
      ok: false,
      step: 1,
      errors: { chatKey: 'Add a gemini key and check it, or pick another provider.' },
    });
    expect(
      buildCreate(form({ embeddingProvider: 'gemini', embeddingModel: 'gemini-embedding-001' }), {}, system),
    ).toMatchObject({
      ok: false,
      step: 2,
      errors: { embeddingKey: 'Add a gemini key and check it, or pick another provider.' },
    });
  });

  it('reuses a key checked on the chat step for embeddings, and saves it once', () => {
    const f = form({
      chatProvider: 'gemini',
      chatModel: 'gemini-2.5-flash',
      embeddingProvider: 'gemini',
      embeddingModel: 'gemini-embedding-001',
    });
    expect(buildCreate(f, { gemini: GEMINI_KEY }, system)).toMatchObject({
      ok: true,
      keys: [{ provider: 'gemini', apiKey: GEMINI_KEY }],
    });
  });
});

describe('stepErrors', () => {
  it('holds a step back only for its own problems', () => {
    const f = form({ chatProvider: 'gemini', chunkSize: 'lots' });
    expect(stepErrors(0, f, {}, system)).toEqual({});
    expect(stepErrors(1, f, {}, system)).toMatchObject({
      chatKey: expect.any(String),
      chatModel: expect.any(String),
    });
    expect(stepErrors(2, f, {}, system)).toEqual({});
    expect(stepErrors(3, f, {}, system)).toEqual({ chunkSize: 'Enter a number.' });
  });

  it('on the review step, is every problem', () => {
    expect(Object.keys(stepErrors(4, form({ slug: '' }), {}, system))).toEqual(['slug']);
  });
});

describe('needsKey', () => {
  it('is true for a hosted provider with no key in .env and none checked here', () => {
    expect(needsKey('gemini', system, {})).toBe(true);
    expect(needsKey('gemini', system, { gemini: 'k' })).toBe(false);
    expect(needsKey('openai', system, {})).toBe(false);
    expect(needsKey('lmstudio', system, {})).toBe(false);
    expect(needsKey('', system, {})).toBe(false);
    expect(needsKey('gemini', undefined, {})).toBe(false);
  });
});

describe('modelsFor', () => {
  it('prefers the models listed with a checked key over the system’s list', () => {
    expect(modelsFor('gemini', system, { gemini: ['gemini-2.5-flash'] })).toEqual(['gemini-2.5-flash']);
    expect(modelsFor('openai', system, {})).toEqual(['gpt-x']);
    expect(modelsFor('', system, {})).toEqual([]);
  });
});

it('maps each field to its step', () => {
  expect([
    stepOf('name'),
    stepOf('chatModel'),
    stepOf('chatKey'),
    stepOf('embeddingKey'),
    stepOf('minScore'),
  ]).toEqual([0, 1, 1, 2, 3]);
});
