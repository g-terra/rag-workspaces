import { providerKeys, type Database } from '@rag/db';
import type { HostedProvider, ModelProviderId, WorkspaceProvider } from '@rag/shared';
import { and, eq } from 'drizzle-orm';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import { ModelCatalog } from './models.js';
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

/** The keys saved for a workspace, opened. A key that won't open (another SECRETS_KEY) is `null`. */
async function savedKeys(db: Database, secretsKey: string | undefined, workspaceId: string) {
  const rows = await db.select().from(providerKeys).where(eq(providerKeys.workspaceId, workspaceId));
  const keys = new Map<HostedProvider, { value: string | null; last4: string }>();
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

/**
 * The config a workspace's flows run with: the API's own, with each key saved for the workspace in
 * place of the one from `.env`. A saved key that can't be opened becomes empty, so a run that needs
 * it fails as "not set" instead of quietly using `.env`'s key.
 */
export async function withWorkspaceKeys<C extends Partial<KeyConfig>>(
  db: Database,
  config: C,
  workspaceId: string,
): Promise<C> {
  const saved = await savedKeys(db, config.SECRETS_KEY, workspaceId);
  if (saved.size === 0) return config;
  const merged: Partial<KeyConfig> = { ...config };
  for (const [provider, { value }] of saved) merged[KEY_NAME[provider]] = value ?? '';
  return merged as C;
}

/** Every provider as the workspace sees it, asked with the key it would use. */
export async function workspaceProviders(
  db: Database,
  config: KeyConfig,
  workspaceId: string,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<WorkspaceProvider[]> {
  const saved = await savedKeys(db, config.SECRETS_KEY, workspaceId);
  const catalog = new ModelCatalog(await withWorkspaceKeys(db, config, workspaceId), fetchFn);
  const statuses = await catalog.status(signal);
  return statuses.map((status) => {
    if (!isHosted(status.id)) return { ...status, key: { source: null, last4: null } };
    const own = saved.get(status.id);
    if (own?.value === null) {
      return {
        ...status,
        configured: false,
        reachable: null,
        models: [],
        error:
          "The key saved for this workspace can't be read: SECRETS_KEY is missing or changed. Save it again.",
        key: { source: 'workspace', last4: own.last4 },
      };
    }
    if (own) return { ...status, key: { source: 'workspace', last4: own.last4 } };
    return { ...status, key: { source: config[KEY_NAME[status.id]] ? 'env' : null, last4: null } };
  });
}

/**
 * Asks a hosted provider for its models with a key that is not saved anywhere, so the create-workspace
 * wizard can offer them before the workspace exists. `422` with the provider's reason when it fails.
 */
export async function checkProviderKey(
  config: KeyConfig,
  provider: ModelProviderId,
  apiKey: string,
  fetchFn: typeof fetch,
  signal: AbortSignal,
) {
  if (!isHosted(provider)) throw new HttpProblem(400, 'LM Studio runs on this machine and takes no API key.');
  const status = await new ModelCatalog({ ...config, [KEY_NAME[provider]]: apiKey }, fetchFn).provider(
    provider,
    signal,
  );
  if (!status.reachable) throw new HttpProblem(422, `The key doesn't work: ${status.error}.`);
  return status;
}

/**
 * Checks a key with the provider (its model list) and saves it encrypted for the workspace,
 * replacing any earlier one. Nothing is saved when the provider refuses it.
 */
export async function saveProviderKey(
  db: Database,
  config: KeyConfig,
  input: { workspaceId: string; provider: ModelProviderId; apiKey: string; savedBy: string },
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  const { workspaceId, provider, apiKey, savedBy } = input;
  if (!isHosted(provider)) throw new HttpProblem(400, 'LM Studio runs on this machine and takes no API key.');
  if (!config.SECRETS_KEY) {
    throw new HttpProblem(
      503,
      "Keys can't be saved: SECRETS_KEY is not set. Run `pnpm env:init` and restart the API, or set the key in .env.",
    );
  }
  await checkProviderKey(config, provider, apiKey, fetchFn, signal);

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
