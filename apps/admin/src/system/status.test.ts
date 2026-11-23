import type { ProviderStatus, ServiceStatus, SystemStatus } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import {
  firstProblem,
  langflowKeyNote,
  latencyNote,
  providerDetail,
  providerLabel,
  serviceLabel,
} from './status';

const service = (name: string, over: Partial<ServiceStatus> = {}): ServiceStatus => ({
  name,
  ok: true,
  latencyMs: 4,
  error: null,
  ...over,
});

const provider = (over: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id: 'lmstudio',
  configured: true,
  reachable: true,
  error: null,
  models: ['a', 'b'],
  embeddings: true,
  ...over,
});

const system = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  version: '0.3.1',
  status: 'ok',
  langflowKey: 'auto',
  services: [service('postgres'), service('chroma'), service('langflow'), service('keycloak')],
  providers: [provider()],
  defaults: {
    chat: { provider: 'lmstudio', model: 'a', available: true },
    embedding: { provider: 'lmstudio', model: 'b', available: true },
  },
  ...over,
});

describe('firstProblem', () => {
  it('is nothing at all when everything answered', () => {
    expect(firstProblem(system())).toBeNull();
  });

  it('names a service that is down, and what to do about it', () => {
    const down = system({
      status: 'degraded',
      services: [service('postgres'), service('chroma', { ok: false, error: 'connection refused' })],
    });
    const problem = firstProblem(down)!;
    expect(problem.what).toBe("ChromaDB isn't answering: connection refused");
    expect(problem.fix).toContain('chroma');
  });

  it('reports the first failing service, so one message is not a list', () => {
    const down = system({
      status: 'degraded',
      services: [service('langflow', { ok: false, error: 'timed out' }), service('chroma', { ok: false })],
    });
    expect(firstProblem(down)!.what).toContain('Langflow');
  });

  it('names a service it has no advice for rather than hiding it', () => {
    const down = system({ status: 'degraded', services: [service('whisper', { ok: false, error: 'off' })] });
    const problem = firstProblem(down)!;
    expect(problem.what).toBe("whisper isn't answering: off");
    expect(problem.fix).toContain('logs');
  });

  it('names the default chat model when its provider cannot serve it', () => {
    const broken = system({
      status: 'degraded',
      providers: [provider({ reachable: false, error: 'connection refused', models: [] })],
      defaults: {
        chat: { provider: 'lmstudio', model: 'a', available: false },
        embedding: { provider: 'lmstudio', model: 'b', available: true },
      },
    });
    const problem = firstProblem(broken)!;
    expect(problem.what).toBe('The default chat model (LM Studio / a) is not available: connection refused');
    expect(problem.fix).toContain('LM Studio');
  });

  it('names the default embedding model too, so uploads do not fail silently', () => {
    const broken = system({
      status: 'degraded',
      defaults: {
        chat: { provider: 'lmstudio', model: 'a', available: true },
        embedding: { provider: 'openai', model: 'b', available: false },
      },
      providers: [provider({ id: 'openai', configured: false, reachable: null, error: 'no key' })],
    });
    const problem = firstProblem(broken)!;
    expect(problem.what).toContain('default embedding model (OpenAI / b)');
    expect(problem.fix).toContain('OPENAI_API_KEY');
  });

  it('says something is wrong when the API calls itself degraded for a reason it cannot read', () => {
    const problem = firstProblem(system({ status: 'degraded' }))!;
    expect(problem.what).toBe('Something the API depends on is not healthy');
    expect(problem.fix).toContain('System');
  });

  it('stays quiet when a service is down but the API still calls itself ok', () => {
    // The API decides what counts as degraded; the banner does not second-guess it.
    expect(firstProblem(system({ services: [service('chroma', { ok: false })] }))).toBeNull();
  });
});

describe('serviceLabel and providerLabel', () => {
  it('uses the names people know', () => {
    expect(serviceLabel('postgres')).toBe('Postgres');
    expect(serviceLabel('chroma')).toBe('ChromaDB');
    expect(providerLabel('lmstudio')).toBe('LM Studio');
    expect(providerLabel('openai')).toBe('OpenAI');
  });

  it('passes an unknown name through, rather than dropping it', () => {
    expect(serviceLabel('whisper')).toBe('whisper');
  });
});

describe('latencyNote', () => {
  it('shows how long a service took to answer', () => {
    expect(latencyNote(service('postgres', { latencyMs: 4 }))).toBe('answered in 4 ms');
  });

  it('shows why it did not, when it did not', () => {
    expect(latencyNote(service('chroma', { ok: false, error: 'refused' }))).toBe('refused');
  });

  it('says a failure with no reason is still a failure', () => {
    expect(latencyNote(service('chroma', { ok: false }))).toBe('did not answer');
  });
});

describe('providerDetail', () => {
  it('counts the models a provider offers', () => {
    expect(providerDetail(provider())).toBe('2 models');
    expect(providerDetail(provider({ models: ['only'] }))).toBe('1 model');
  });

  it('gives the reason instead when there was one', () => {
    expect(
      providerDetail(provider({ configured: false, reachable: null, error: 'no key', models: [] })),
    ).toBe('no key');
  });

  it('notes a provider that cannot embed, which is why it is not an embedding choice', () => {
    expect(providerDetail(provider({ id: 'anthropic', embeddings: false }))).toBe('2 models · chat only');
  });
});

describe('langflowKeyNote', () => {
  it('says where the Langflow key came from', () => {
    expect(langflowKeyNote('auto')).toContain('minted');
    expect(langflowKeyNote('env')).toContain('LANGFLOW_API_KEY');
    expect(langflowKeyNote('none')).toContain('no key');
  });
});
