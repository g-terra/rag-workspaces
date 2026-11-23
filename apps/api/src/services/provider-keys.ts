import { providerKeys, type Database } from '@rag/db';
import type { HostedProvider, ModelProviderId, ProviderStatus, WorkspaceProvider } from '@rag/shared';
import { and, eq } from 'drizzle-orm';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import { ModelCatalog } from './models.js';
import { UNREADABLE_KEY } from './providers.js';
import { openSecret, sealSecret, SecretUnreadable } from './secrets.js';

type KeyName = 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'ANTHROPIC_API_KEY';
export type KeyConfig = Pick<Config, 'SECRETS_KEY' | 'LMSTUDIO_BASE_URL' | KeyName>;

const KEY_NAME: Record<HostedProvider, KeyName> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

const isHosted = (id: string): id is HostedProvider => id in KEY_NAME;
const context = (workspaceId: string, provider: string) => `${workspaceId}:${provider}`;

type Saved = Map<HostedProvider, { value: string | null; last4: string }>;

/** The keys saved for a workspace, opened. A key that won't open (another SECRETS_KEY) is `null`. */
async function savedKeys(db: Database, secretsKey: string | undefined, workspaceId: string): Promise<Saved> {
  const rows = await db.select().from(providerKeys).where(eq(providerKeys.workspaceId, workspaceId));
  const keys: Saved = new Map();
  for (const row of rows) {
    if (!isHosted(row.provider)) continue;
    let value: string | null = null;
    try {
      if (secretsKey) value = openSecret(secretsKey, row.sealed, context(workspaceId, row.provider));
    } catch (err) {
      if (!(err instanceof SecretUnreadable)) throw err;
    }
    keys.set(row.provider, { value, last4: row.last4 });
  }
  return keys;
}

/** `config` with the saved keys in place of `.env`'s; an unreadable one becomes `unreadable`. */
function merge<C extends Partial<KeyConfig>>(config: C, saved: Saved, unreadable: string | undefined): C {
  if (saved.size === 0) return config;
  const merged: Partial<KeyConfig> = { ...config };
  for (const [provider, { value }] of saved) merged[KEY_NAME[provider]] = value ?? unreadable;
  return merged as C;
}

/**
 * The config a workspace's flows run with: the API's own, with each key saved for the workspace in
 * place of the one from `.env`. A saved key that can't be opened becomes `UNREADABLE_KEY`, which the
 * provider endpoints refuse with the reason, so a run never quietly falls back to `.env`'s key.
 */
export async function withWorkspaceKeys<C extends Partial<KeyConfig>>(
  db: Database,
  config: C,
  workspaceId: string,
): Promise<C> {
  return merge(config, await savedKeys(db, config.SECRETS_KEY, workspaceId), UNREADABLE_KEY);
}

const keyInfo = (status: ProviderStatus, saved: Saved, config: KeyConfig): WorkspaceProvider['key'] => {
  if (!isHosted(status.id)) return { source: null, last4: null };
  const own = saved.get(status.id);
  if (own) return { source: 'workspace', last4: own.last4 };
  return { source: config[KEY_NAME[status.id]] ? 'env' : null, last4: null };
};

/** Every provider as the workspace sees it, asked with the key it would use. */
export async function workspaceProviders(
  db: Database,
  config: KeyConfig,
  workspaceId: string,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<WorkspaceProvider[]> {
  const saved = await savedKeys(db, config.SECRETS_KEY, workspaceId);
  // An unreadable key is left out (undefined), so the provider is not asked with anything.
  const statuses = await new ModelCatalog(merge(config, saved, undefined), fetchFn).status(signal);
  return statuses.map((status) => {
    const key = keyInfo(status, saved, config);
    if (isHosted(status.id) && saved.get(status.id)?.value === null) {
      return {
        ...status,
        error:
          "The key saved for this workspace can't be read: SECRETS_KEY is missing or changed. Save it again.",
        key,
      };
    }
    return { ...status, key };
  });
}

/**
 * Asks a hosted provider for its models with a key, which is not stored. `422` when the provider
 * turned the key down, `504` when it didn't answer in time, `502` when it failed otherwise (down,
 * busy). `outcome` starts the error: what did not happen because of it.
 */
export async function checkProviderKey(
  config: KeyConfig,
  provider: ModelProviderId,
  apiKey: string,
  fetchFn: typeof fetch,
  signal: AbortSignal,
  outcome = 'The key was not saved',
): Promise<ProviderStatus> {
  if (!isHosted(provider)) throw new HttpProblem(400, 'LM Studio runs on this machine and takes no API key.');
  const { status, refused } = await new ModelCatalog(
    { ...config, [KEY_NAME[provider]]: apiKey },
    fetchFn,
  ).check(provider, signal);
  if (status.reachable) return status;
  if (refused) throw new HttpProblem(422, `${outcome}: ${status.error}.`);
  const timedOut = signal.aborted || /timeout|aborted/i.test(status.error ?? '');
  throw new HttpProblem(
    timedOut ? 504 : 502,
    `${outcome}, because ${provider} couldn't be asked whether it works: ${status.error}. Try again.`,
  );
}

/**
 * Checks a key with the provider (its model list) and saves it encrypted for the workspace,
 * replacing any earlier one. Nothing is saved unless the provider accepts it. Answers with the
 * provider as the workspace now sees it.
 */
export async function saveProviderKey(
  db: Database,
  config: KeyConfig,
  input: { workspaceId: string; provider: ModelProviderId; apiKey: string; savedBy: string },
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<WorkspaceProvider> {
  const { workspaceId, provider, apiKey, savedBy } = input;
  if (!isHosted(provider)) throw new HttpProblem(400, 'LM Studio runs on this machine and takes no API key.');
  if (!config.SECRETS_KEY) {
    throw new HttpProblem(
      503,
      "Keys can't be saved: SECRETS_KEY is not set. Run `pnpm env:init` and restart the API, or set the key in .env.",
    );
  }
  const status = await checkProviderKey(config, provider, apiKey, fetchFn, signal);

  const row = {
    workspaceId,
    provider,
    sealed: sealSecret(config.SECRETS_KEY, apiKey, context(workspaceId, provider)),
    last4: apiKey.slice(-4),
    savedBy,
  };
  await db
    .insert(providerKeys)
    .values(row)
    .onConflictDoUpdate({
      target: [providerKeys.workspaceId, providerKeys.provider],
      set: { sealed: row.sealed, last4: row.last4, savedBy },
    });
  return { ...status, key: { source: 'workspace', last4: row.last4 } };
}

/** Removes a saved key; false when there was none. */
export async function removeProviderKey(
  db: Database,
  workspaceId: string,
  provider: string,
): Promise<boolean> {
  const removed = await db
    .delete(providerKeys)
    .where(and(eq(providerKeys.workspaceId, workspaceId), eq(providerKeys.provider, provider)))
    .returning();
  return removed.length > 0;
}
