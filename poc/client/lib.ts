// Minimal typed client for the parts of Langflow's HTTP API the plan relies on.
// Zero dependencies (Node 22 fetch). Run files with `node file.ts`.

export const LANGFLOW_URL = process.env.LANGFLOW_URL ?? 'http://localhost:7860';
export const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000';

export type Tweaks = Record<string, Record<string, unknown>>;

export async function readEnvFile(path = new URL('../.env', import.meta.url)): Promise<Record<string, string>> {
  const { readFile } = await import('node:fs/promises');
  const out: Record<string, string> = {};
  try {
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
  } catch { /* no .env */ }
  return out;
}

async function check(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${await res.text()}`);
  return res;
}

/**
 * Log in as the superuser (LANGFLOW_AUTO_LOGIN=false) and return a JWT access token.
 * Langflow rate-limits /login (HTTP 429 with retry_after), so honour that and retry.
 */
export async function login(username: string, password: string, attempts = 4): Promise<string> {
  for (let i = 1; ; i++) {
    const res = await fetch(`${LANGFLOW_URL}/api/v1/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }),
    });
    if (res.status === 429 && i < attempts) {
      const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 60);
      console.warn(`login rate-limited, retrying in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    return (await (await check(res, 'login')).json()).access_token;
  }
}

export function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Create a Langflow API key (sk-...) for the logged-in user. */
export async function createApiKey(token: string, name: string): Promise<string> {
  const res = await check(await fetch(`${LANGFLOW_URL}/api/v1/api_key/`, {
    method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }), 'create api key');
  return (await res.json()).api_key;
}

export async function listApiKeys(token: string): Promise<{ id: string; name: string }[]> {
  const res = await check(await fetch(`${LANGFLOW_URL}/api/v1/api_key/`, { headers: bearer(token) }), 'list api keys');
  const body = await res.json();
  return body.api_keys ?? body;
}

export async function deleteApiKey(token: string, id: string): Promise<void> {
  await check(await fetch(`${LANGFLOW_URL}/api/v1/api_key/${id}`, { method: 'DELETE', headers: bearer(token) }), 'delete api key');
}

export type FlowFile = { id: string; name: string; description?: string; endpoint_name?: string; data: unknown };

export async function getFlow(auth: Record<string, string>, id: string): Promise<any | null> {
  const res = await fetch(`${LANGFLOW_URL}/api/v1/flows/${id}`, { headers: auth });
  if (res.status === 404) return null;
  return (await check(res, `get flow ${id}`)).json();
}

/** Create the flow with its fixed id, or update it in place if it exists. Idempotent. */
export async function upsertFlow(auth: Record<string, string>, flow: FlowFile): Promise<'created' | 'updated'> {
  const body = JSON.stringify({ name: flow.name, description: flow.description, endpoint_name: flow.endpoint_name, data: flow.data });
  if (await getFlow(auth, flow.id)) {
    await check(await fetch(`${LANGFLOW_URL}/api/v1/flows/${flow.id}`, {
      method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body,
    }), `update flow ${flow.name}`);
    return 'updated';
  }
  await check(await fetch(`${LANGFLOW_URL}/api/v1/flows/`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: flow.id, ...JSON.parse(body) }),
  }), `create flow ${flow.name}`);
  return 'created';
}

export type RunBody = { input_value?: string; input_type?: string; output_type?: string; tweaks?: Tweaks; session_id?: string };

/** POST /api/v1/run/{flow} (non-streaming). */
export async function runFlow(apiKey: string, flow: string, body: RunBody): Promise<any> {
  const res = await check(await fetch(`${LANGFLOW_URL}/api/v1/run/${flow}?stream=false`, {
    method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ input_type: 'chat', output_type: 'chat', ...body }),
  }), `run ${flow}`);
  return res.json();
}

export type StreamEvent = { event: string; data: any; receivedAtMs: number };

/** POST /api/v1/run/{flow}?stream=true and yield each event as it arrives. */
export async function* streamFlow(apiKey: string, flow: string, body: RunBody): AsyncGenerator<StreamEvent> {
  const started = performance.now();
  const res = await check(await fetch(`${LANGFLOW_URL}/api/v1/run/${flow}?stream=true`, {
    method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ input_type: 'chat', output_type: 'chat', ...body }),
  }), `stream ${flow}`);
  const decoder = new TextDecoder();
  let buf = '';
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(part, { stream: true });
    let nl: number;
    // Langflow sends one JSON object per event, separated by blank lines.
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const json = line.startsWith('data:') ? line.slice(5).trim() : line;
      try {
        const ev = JSON.parse(json);
        yield { event: ev.event, data: ev.data, receivedAtMs: performance.now() - started };
      } catch { /* partial or non-JSON line */ }
    }
  }
}

/** Collect every ChatOutput message in a run response, keyed by component id. */
export function outputsByComponent(run: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const block of run.outputs ?? []) {
    for (const o of block.outputs ?? []) {
      out[o.component_id] = o;
    }
  }
  return out;
}

export function messageText(output: any): string {
  return output?.results?.message?.text ?? output?.outputs?.message?.message ?? output?.messages?.[0]?.message ?? '';
}

// --- Chroma REST (v2) helpers, used to verify what the flows wrote ---------------------------------

const CHROMA_BASE = `${CHROMA_URL}/api/v2/tenants/default_tenant/databases/default_database`;

export async function chromaCollectionId(name: string): Promise<string | null> {
  const res = await fetch(`${CHROMA_BASE}/collections/${name}`);
  if (res.status === 404) return null;
  return (await check(res, `chroma collection ${name}`)).json().then((c) => c.id);
}

export async function chromaGet(name: string, where?: object): Promise<{ ids: string[]; metadatas: any[] }> {
  const id = await chromaCollectionId(name);
  if (!id) return { ids: [], metadatas: [] };
  const res = await check(await fetch(`${CHROMA_BASE}/collections/${id}/get`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ where, include: ['metadatas'] }),
  }), 'chroma get');
  return res.json();
}

export async function chromaDeleteWhere(name: string, where: object): Promise<void> {
  const id = await chromaCollectionId(name);
  if (!id) return;
  await check(await fetch(`${CHROMA_BASE}/collections/${id}/delete`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ where }),
  }), 'chroma delete');
}

export async function chromaDropCollection(name: string): Promise<void> {
  await fetch(`${CHROMA_BASE}/collections/${name}`, { method: 'DELETE' });
}
