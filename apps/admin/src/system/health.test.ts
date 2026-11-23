import type { SystemStatus } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { summarizeSystem } from './health';

function system(overrides: Partial<SystemStatus> = {}): SystemStatus {
  return {
    version: '0.2.0',
    status: 'ok',
    langflowKey: 'auto',
    services: [
      { name: 'postgres', ok: true, latencyMs: 3, error: null },
      { name: 'langflow', ok: true, latencyMs: 41, error: null },
    ],
    providers: [
      {
        id: 'lmstudio',
        configured: true,
        reachable: true,
        error: null,
        models: ['gpt-oss-20b', 'text-embedding-nomic-embed-text-v1.5'],
        embeddings: true,
      },
      { id: 'openai', configured: false, reachable: null, error: null, models: [], embeddings: true },
    ],
    defaults: {
      chat: { provider: 'lmstudio', model: 'gpt-oss-20b', available: true },
      embedding: { provider: 'lmstudio', model: 'text-embedding-nomic-embed-text-v1.5', available: true },
      workspace: {
        chunkSize: 1000,
        chunkOverlap: 150,
        topK: 5,
        minScore: 0,
        systemPrompt: '',
        reasoningEffort: null,
      },
    },
    ...overrides,
  };
}

describe('summarizeSystem', () => {
  it('lists services, providers and default models, with no problems when all is well', () => {
    const { problems, rows } = summarizeSystem(system());
    expect(problems).toBe(0);
    expect(rows).toEqual([
      { group: 'service', name: 'Postgres', state: 'ok', detail: '3 ms' },
      { group: 'service', name: 'Langflow', state: 'ok', detail: '41 ms' },
      { group: 'provider', name: 'LM Studio', state: 'ok', detail: '2 models' },
      { group: 'provider', name: 'OpenAI', state: 'off', detail: 'Not set up' },
      { group: 'model', name: 'Chat model', state: 'ok', detail: 'gpt-oss-20b on LM Studio' },
      {
        group: 'model',
        name: 'Embedding model',
        state: 'ok',
        detail: 'text-embedding-nomic-embed-text-v1.5 on LM Studio',
      },
    ]);
  });

  it('counts a failing service, an unreachable provider and a missing default model as problems', () => {
    const base = system();
    const { problems, rows } = summarizeSystem(
      system({
        status: 'degraded',
        services: [{ name: 'chroma', ok: false, latencyMs: 2000, error: 'timed out after 2000 ms' }],
        providers: [
          {
            id: 'gemini',
            configured: true,
            reachable: false,
            error: 'HTTP 401',
            models: [],
            embeddings: true,
          },
        ],
        defaults: {
          ...base.defaults,
          chat: { provider: 'gemini', model: 'gemini-2.5-flash', available: false },
        },
      }),
    );
    expect(problems).toBe(3);
    expect(rows).toContainEqual({
      group: 'service',
      name: 'ChromaDB',
      state: 'down',
      detail: 'timed out after 2000 ms',
    });
    expect(rows).toContainEqual({ group: 'provider', name: 'Gemini', state: 'down', detail: 'HTTP 401' });
    expect(rows).toContainEqual({
      group: 'model',
      name: 'Chat model',
      state: 'down',
      detail: 'gemini-2.5-flash on Gemini is not available',
    });
  });

  it('names a service it does not know by its own name, and says "1 model"', () => {
    const { rows } = summarizeSystem(
      system({
        services: [{ name: 'whisper', ok: true, latencyMs: 0, error: null }],
        providers: [
          {
            id: 'anthropic',
            configured: true,
            reachable: true,
            error: null,
            models: ['x'],
            embeddings: false,
          },
        ],
      }),
    );
    expect(rows[0]).toMatchObject({ name: 'whisper', detail: '0 ms' });
    expect(rows[1]).toMatchObject({ name: 'Anthropic', detail: '1 model' });
  });

  it('says why when an unreachable provider gave no error text', () => {
    const { rows } = summarizeSystem(
      system({
        providers: [
          { id: 'lmstudio', configured: true, reachable: false, error: null, models: [], embeddings: true },
        ],
      }),
    );
    expect(rows).toContainEqual({
      group: 'provider',
      name: 'LM Studio',
      state: 'down',
      detail: 'Not reachable',
    });
  });
});
