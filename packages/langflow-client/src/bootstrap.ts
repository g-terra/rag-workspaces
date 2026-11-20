import type { LangflowClient } from './client.js';

export type ProvisionKeyOptions = {
  username: string;
  password: string;
  /** Keys this API created start with this; older ones are revoked after a new one is made. */
  keyPrefix?: string;
  now?: () => Date;
};

export type ProvisionKeyResult = { apiKey: string; revoked: number };

/**
 * Sign in as the Langflow superuser and mint a fresh API key for the API (decision 17).
 * Langflow shows a key's value only once, so the API makes a new one on every start
 * and revokes the ones it made before (POC F4). The key is kept in memory only.
 */
export async function provisionApiKey(
  client: LangflowClient,
  { username, password, keyPrefix = 'rag-api', now = () => new Date() }: ProvisionKeyOptions,
): Promise<ProvisionKeyResult> {
  const token = await client.login(username, password);
  const old = (await client.listApiKeys(token)).filter((k) => k.name?.startsWith(`${keyPrefix}-`));
  const apiKey = await client.createApiKey(token, `${keyPrefix}-${now().toISOString()}`);
  for (const k of old) await client.deleteApiKey(token, k.id);
  return { apiKey, revoked: old.length };
}
