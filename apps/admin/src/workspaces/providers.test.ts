import type { SystemStatus, WorkspaceProvider } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { HOSTED, keyNote, providerKeyErrorMessage, withWorkspaceProviders } from './providers';

const provider = (over: Partial<WorkspaceProvider> = {}): WorkspaceProvider => ({
  id: 'gemini',
  configured: true,
  reachable: true,
  error: null,
  models: ['gemini-2.5-flash'],
  embeddings: true,
  key: { source: 'workspace', last4: 'x9Qa' },
  ...over,
});

describe('keyNote', () => {
  it('says where the key comes from, never more than its last four characters', () => {
    expect(keyNote(provider())).toBe('Saved for this workspace, ending in x9Qa.');
    expect(keyNote(provider({ key: { source: 'env', last4: null } }))).toBe(
      'Using the key in the API’s .env. Save one here to use another for this workspace.',
    );
    expect(keyNote(provider({ configured: false, key: { source: null, last4: null } }))).toBe('No key yet.');
  });

  it('adds why a key does not work', () => {
    expect(keyNote(provider({ reachable: false, error: 'Gemini refused the key (HTTP 400)' }))).toBe(
      'Saved for this workspace, ending in x9Qa. Gemini refused the key (HTTP 400).',
    );
  });
});

describe('withWorkspaceProviders', () => {
  const system = { providers: [], defaults: {} } as unknown as SystemStatus;

  it('puts the providers as the workspace sees them into the system status', () => {
    const list = [provider()];
    expect(withWorkspaceProviders(system, list)?.providers).toBe(list);
  });

  it('keeps the system status as it is until the workspace list arrives', () => {
    expect(withWorkspaceProviders(system, undefined)).toBe(system);
    expect(withWorkspaceProviders(undefined, [provider()])).toBeUndefined();
  });
});

describe('providerKeyErrorMessage', () => {
  it('passes on what the provider or the API said', () => {
    expect(providerKeyErrorMessage(new ApiError(422, 'The key was not saved: refused.'))).toBe(
      'The key was not saved: refused.',
    );
    expect(providerKeyErrorMessage(new ApiError(503, 'SECRETS_KEY is not set'))).toBe(
      'SECRETS_KEY is not set',
    );
  });

  it('explains anything else', () => {
    expect(providerKeyErrorMessage(new Error('offline'))).toBe("Couldn't save the key: offline");
  });
});

it('lists the providers that take a key', () => {
  expect(HOSTED).toEqual(['openai', 'gemini', 'anthropic']);
});
