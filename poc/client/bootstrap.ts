// Startup automation the real API will run on boot (assumption 4):
//   1. wait for Langflow, 2. log in as the superuser (auto-login is off),
//   3. make sure the repo's flows are present (idempotent upsert by fixed id),
//   4. mint a fresh API key for the API, revoking older ones it created.
//
//   node client/bootstrap.ts      -> prints the key and saves it to .langflow-api-key

import { readdir, readFile, writeFile } from 'node:fs/promises';
import {
  LANGFLOW_URL, bearer, createApiKey, deleteApiKey, getFlow, listApiKeys, login, readEnvFile, upsertFlow,
  type FlowFile,
} from './lib.ts';

const KEY_PREFIX = 'rag-api';

export async function waitForLangflow(timeoutMs = 300_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { if ((await fetch(`${LANGFLOW_URL}/health_check`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Langflow did not become healthy');
}

export async function loadFlowFiles(): Promise<FlowFile[]> {
  const dir = new URL('../flows/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(new URL(f, dir), 'utf8'))));
}

export type BootstrapResult = {
  apiKey: string;
  flows: { name: string; id: string; presentBeforeBootstrap: boolean; action: 'created' | 'updated' }[];
  revokedKeys: number;
};

export async function bootstrap(): Promise<BootstrapResult> {
  const env = { ...(await readEnvFile()), ...process.env };
  await waitForLangflow();
  const token = await login(env.LANGFLOW_SUPERUSER ?? 'admin', env.LANGFLOW_SUPERUSER_PASSWORD!);

  const flows: BootstrapResult['flows'] = [];
  for (const flow of await loadFlowFiles()) {
    const presentBeforeBootstrap = Boolean(await getFlow(bearer(token), flow.id));
    const action = await upsertFlow(bearer(token), flow);
    flows.push({ name: flow.name, id: flow.id, presentBeforeBootstrap, action });
  }

  // Langflow only shows a key's value once, at creation. So on every boot the API
  // mints a new key and revokes the ones it made before (matched by name prefix).
  const old = (await listApiKeys(token)).filter((k) => k.name?.startsWith(KEY_PREFIX));
  const apiKey = await createApiKey(token, `${KEY_PREFIX}-${new Date().toISOString()}`);
  for (const k of old) await deleteApiKey(token, k.id);

  return { apiKey, flows, revokedKeys: old.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await bootstrap();
  await writeFile(new URL('../.langflow-api-key', import.meta.url), result.apiKey + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ ...result, apiKey: result.apiKey.slice(0, 6) + '…' }, null, 2));
}
