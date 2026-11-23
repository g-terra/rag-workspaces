import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CUSTOM_MODEL,
  modelIdError,
  modelOptions,
  providerOptions,
  transcriptionEnv,
  whisperModelOptions,
} from './choices.ts';

describe('providerOptions', () => {
  it('offers all four providers for chat', () => {
    const values = providerOptions('chat').map((o) => o.value);
    assert.deepEqual(values, ['lmstudio', 'openai', 'gemini', 'anthropic']);
  });

  it('omits Anthropic for embeddings because it has no embedding models', () => {
    const values = providerOptions('embedding').map((o) => o.value);
    assert.deepEqual(values, ['lmstudio', 'openai', 'gemini']);
  });
});

describe('modelOptions', () => {
  it('splits LM Studio models by kind, prioritises the current model and appends custom entry', () => {
    const result = modelOptions(
      'chat',
      'lmstudio',
      ['text-embedding-nomic-embed-text-v1.5', 'llama-3.2', 'qwen2.5-7b-instruct'],
      'llama-3.2',
      'qwen2.5-7b-instruct',
    );
    assert.ok(result);
    assert.equal(result.initialValue, 'llama-3.2');
    assert.deepEqual(result.options, [
      { value: 'llama-3.2', label: 'llama-3.2', hint: 'current' },
      { value: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct', hint: 'recommended' },
      { value: CUSTOM_MODEL, label: 'Enter a custom model id…', hint: 'type any id' },
    ]);
  });

  it('picks the suggested model as initialValue when current is absent', () => {
    const result = modelOptions(
      'embedding',
      'openai',
      ['gpt-4o-mini', 'text-embedding-3-large', 'text-embedding-3-small'],
      '',
      'text-embedding-3-small',
    );
    assert.ok(result);
    assert.equal(result.initialValue, 'text-embedding-3-small');
    assert.deepEqual(
      result.options.map((o) => o.value),
      ['text-embedding-3-small', 'text-embedding-3-large', CUSTOM_MODEL],
    );
  });

  it('falls back to the full model list for hosted providers if no id matches the kind heuristic', () => {
    const result = modelOptions('embedding', 'gemini', ['custom-vec-1', 'custom-vec-2'], '', 'other');
    assert.ok(result);
    assert.equal(result.initialValue, 'custom-vec-1');
    assert.deepEqual(
      result.options.map((o) => o.value),
      ['custom-vec-1', 'custom-vec-2', CUSTOM_MODEL],
    );
  });

  it('returns null when no models are available for the chosen kind', () => {
    assert.equal(modelOptions('chat', 'lmstudio', [], '', 'qwen2.5-7b-instruct'), null);
    assert.equal(modelOptions('embedding', 'lmstudio', ['qwen2.5-7b-instruct'], '', 'nomic'), null);
  });
});

describe('whisperModelOptions', () => {
  it('lists the sizes smallest first, each with its download and memory cost', () => {
    const options = whisperModelOptions();
    assert.deepEqual(
      options.map((o) => o.value),
      ['tiny', 'base', 'small', 'medium', 'large-v3'],
    );
    assert.ok(options.every((o) => /MB|GB/.test(o.hint ?? '')));
  });
});

describe('transcriptionEnv', () => {
  it('turns the video profile on, points the API at the whisper service and sets the model', () => {
    assert.deepEqual(transcriptionEnv(true, 'small', ''), {
      COMPOSE_PROFILES: 'video',
      WHISPER_URL: 'http://whisper:9000',
      WHISPER_MODEL: 'small',
    });
  });

  it('keeps other compose profiles and does not add video twice', () => {
    assert.equal(transcriptionEnv(true, 'base', 'gpu').COMPOSE_PROFILES, 'gpu,video');
    assert.equal(transcriptionEnv(true, 'base', 'video,gpu').COMPOSE_PROFILES, 'video,gpu');
  });

  it('turning it off removes only the video profile and the Whisper URL, keeping the model choice', () => {
    assert.deepEqual(transcriptionEnv(false, 'small', 'gpu,video'), {
      COMPOSE_PROFILES: 'gpu',
      WHISPER_URL: '',
    });
  });
});

describe('modelIdError', () => {
  it('lets an empty answer through when there is a default to take', () => {
    assert.equal(modelIdError('', 'qwen3-8b'), undefined);
    assert.equal(modelIdError('  ', 'qwen3-8b'), undefined);
  });

  it('asks for an id when the answer is empty and there is no default', () => {
    assert.equal(modelIdError('', ''), 'A model id is required.');
    assert.equal(modelIdError(undefined, ''), 'A model id is required.');
  });

  it('accepts any typed id', () => {
    assert.equal(modelIdError('gpt-4o-mini', ''), undefined);
  });
});
