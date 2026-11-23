// The smoke checks, against a running smoke stack (node scripts/smoke/stack.ts up).
// Signs in through the real Keycloak, then runs the ingestion path end to end and checks what the
// ingest flow wrote into Chroma. Exits non-zero at the first failed check.
//   node scripts/smoke/check.ts
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { compose, smokeEnv } from './stack.ts';

const env = smokeEnv();
const API = env.PUBLIC_API_URL!;
const KEYCLOAK = env.KEYCLOAK_PUBLIC_URL!;
const CHROMA = `http://127.0.0.1:${env.CHROMA_PORT}/api/v2/tenants/default_tenant/databases/default_database`;
const READY_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const repoRoot = new URL('../../', import.meta.url);

const FIXTURES = [
  { path: 'poc/samples/ouc/cos512-notes.pdf', hasPages: true },
  { path: 'poc/samples/ouc/assignment-brief.docx', hasPages: false },
  { path: 'poc/samples/ouc/langflow-tips.md', hasPages: false },
];

type Doc = {
  id: string;
  fileName: string;
  status: string;
  passageCount: number | null;
  error: string | null;
};
type Passage = { document_id: string; page: number | null; folder?: string };

class CheckFailed extends Error {}

function expect(ok: unknown, message: string): asserts ok {
  if (!ok) throw new CheckFailed(message);
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await fn();
  console.log(`ok  ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  return result;
}

async function call(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body instanceof FormData || body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  expect(res.ok, `${method} ${path}: expected 2xx, got ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function chroma(path: string, body?: unknown): Promise<Response> {
  return fetch(`${CHROMA}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Password grant is off in the realm; switch it on for admin-ui in this throwaway stack only.
 * kcadm reads the Keycloak admin login from the container's own environment, so it never appears
 * in a command line or a log.
 */
function allowPasswordLogin() {
  const kcadm = '/opt/keycloak/bin/kcadm.sh';
  const script = [
    'set -e',
    // Keycloak reports ready a moment before its HTTP port stops answering 503, so retry for a minute.
    `login() { ${kcadm} config credentials --server http://localhost:8080 --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"; }`,
    'n=0; until login >/dev/null 2>&1; do n=$((n + 1)); if [ $n -ge 30 ]; then login; exit 1; fi; sleep 2; done',
    `id=$(${kcadm} get clients -r rag-workspaces -q clientId=admin-ui --fields id --format csv --noquotes)`,
    `${kcadm} update "clients/$id" -r rag-workspaces -s directAccessGrantsEnabled=true`,
  ].join('\n');
  compose(['exec', '-T', 'keycloak', 'bash', '-c', script]);
}

async function login(): Promise<string> {
  const res = await fetch(`${KEYCLOAK}/realms/rag-workspaces/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-ui',
      username: env.RW_ADMIN_USERNAME!,
      password: env.RW_ADMIN_PASSWORD!,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  expect(res.ok && body.access_token, `Keycloak login failed: ${res.status} ${body.error_description}`);
  return body.access_token;
}

async function waitUntilReady(token: string, slug: string, ids: string[]): Promise<Doc[]> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const docs: Doc[] = await Promise.all(
      ids.map((id) => call(token, 'GET', `/v1/workspaces/${slug}/documents/${id}`)),
    );
    const failed = docs.find((d) => d.status === 'failed');
    expect(!failed, `${failed?.fileName} failed to ingest: ${failed?.error}`);
    if (docs.every((d) => d.status === 'ready')) return docs;
    expect(
      Date.now() < deadline,
      `not ready after ${READY_TIMEOUT_MS / 1000} s: ${docs.map((d) => `${d.fileName}=${d.status}`).join(', ')}`,
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function passagesOf(collection: string, documentId: string): Promise<Passage[]> {
  const found = await chroma(`/collections/${collection}`);
  expect(found.ok, `Chroma collection ${collection} not found: ${found.status}`);
  const { id } = (await found.json()) as { id: string };
  const res = await chroma(`/collections/${id}/get`, {
    where: { document_id: documentId },
    include: ['metadatas'],
  });
  if (!res.ok) throw new CheckFailed(`Chroma get failed: ${res.status} ${await res.text()}`);
  const { metadatas } = (await res.json()) as { metadatas: Passage[] };
  return metadatas;
}

async function main() {
  await step('password login enabled for admin-ui (this stack only)', async () => allowPasswordLogin());
  const token = await step('signed in through Keycloak', login);
  await step('GET /v1/me says admin', async () => {
    const me = await call(token, 'GET', '/v1/me');
    expect(me.isAdmin === true, `expected isAdmin true, got ${JSON.stringify(me)}`);
  });
  await step('responses carry the rate limit headers', async () => {
    const res = await fetch(`${API}/v1/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const limit = res.headers.get('ratelimit-limit');
    expect(limit === '600' && res.headers.get('ratelimit-remaining'), `RateLimit-Limit: ${limit}`);
  });
  await step('GET /v1/users lists the admin, read through the api-directory service account', async () => {
    const { data } = (await call(token, 'GET', `/v1/users?search=${env.RW_ADMIN_USERNAME}`)) as {
      data: { username: string; isAdmin: boolean }[];
    };
    const admin = data.find((u) => u.username === env.RW_ADMIN_USERNAME);
    expect(admin?.isAdmin === true, `expected the admin with isAdmin true, got ${JSON.stringify(data)}`);
  });

  await step('GET /v1/system: every service up, the stand-in lists the embedding model', async () => {
    const system = await call(token, 'GET', '/v1/system');
    const down = system.services.filter((s: { ok: boolean }) => !s.ok);
    expect(!down.length, `services down: ${JSON.stringify(down)}`);
    expect(system.langflowKey === 'auto', `expected a minted Langflow key, got ${system.langflowKey}`);
    const lm = system.providers.find((p: { id: string }) => p.id === 'lmstudio');
    expect(
      lm?.reachable && lm.models.includes('standin-embed-a'),
      `LM Studio stand-in: ${JSON.stringify(lm)}`,
    );
    expect(
      system.defaults.embedding.available,
      `embedding default: ${JSON.stringify(system.defaults.embedding)}`,
    );
  });

  const slug = `smoke-${Date.now()}`;
  const collection = `ws_${slug}`;
  await step(`created workspace ${slug}`, () =>
    call(token, 'POST', '/v1/workspaces', { slug, name: 'Smoke test' }),
  );

  const uploaded = await step('uploaded PDF, DOCX and MD', async () => {
    const form = new FormData();
    for (const f of FIXTURES)
      form.append('files', new Blob([readFileSync(new URL(f.path, repoRoot))]), basename(f.path));
    const { data } = (await call(token, 'POST', `/v1/workspaces/${slug}/documents`, form)) as {
      data: { document: Doc; duplicate: boolean }[];
    };
    expect(data.length === FIXTURES.length, `expected ${FIXTURES.length} documents, got ${data.length}`);
    expect(!data.some((d) => d.duplicate), 'a fresh workspace reported a duplicate upload');
    return data.map((d) => d.document);
  });

  const docs = await step('all documents ready', () =>
    waitUntilReady(
      token,
      slug,
      uploaded.map((d) => d.id),
    ),
  );

  for (const fixture of FIXTURES) {
    const name = basename(fixture.path);
    await step(`${name}: passages in Chroma match the API, page metadata right`, async () => {
      const doc = docs.find((d) => d.fileName === name);
      expect(doc, `no document for ${name}`);
      expect(doc.passageCount && doc.passageCount > 0, `${name}: passageCount is ${doc.passageCount}`);
      const passages = await passagesOf(collection, doc.id);
      expect(
        passages.length === doc.passageCount,
        `${name}: API says ${doc.passageCount} passages, Chroma has ${passages.length}`,
      );
      const pages = passages.map((p) => p.page);
      if (fixture.hasPages) {
        expect(
          pages.every((p) => typeof p === 'number' && p >= 1),
          `${name}: every passage needs a page >= 1, got ${JSON.stringify(pages)}`,
        );
      } else {
        expect(
          pages.every((p) => p === null || p === undefined),
          `${name}: expected no page numbers, got ${JSON.stringify(pages)}`,
        );
      }
    });
  }

  await step('reindexed the workspace: search waits, then every passage is back', async () => {
    const started = await call(token, 'POST', `/v1/workspaces/${slug}/reindex`);
    expect(started.status === 'reindexing', `expected reindexing, got ${started.status}`);
    const blocked = await fetch(`${API}/v1/workspaces/${slug}/passages?query=notes`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // The stand-in model is quick, so the reindex may already be over.
    expect([200, 503].includes(blocked.status), `passages during reindex: ${blocked.status}`);
    const again = await waitUntilReady(
      token,
      slug,
      docs.map((d) => d.id),
    );
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while ((await call(token, 'GET', `/v1/workspaces/${slug}`)).status !== 'active') {
      expect(Date.now() < deadline, 'workspace still reindexing with every document ready');
      await new Promise((r) => setTimeout(r, 1000));
    }
    for (const doc of again) {
      const passages = await passagesOf(collection, doc.id);
      expect(
        passages.length === doc.passageCount,
        `${doc.fileName} after reindex: API says ${doc.passageCount}, Chroma has ${passages.length}`,
      );
    }
  });

  await step(
    'folders: a moved document takes its passages along, search can stay inside one, and deleting it moves them out',
    async () => {
      const doc = docs[0]!;
      const folder = await call(token, 'POST', `/v1/workspaces/${slug}/folders`, { name: 'Week 1' });
      await call(token, 'PATCH', `/v1/workspaces/${slug}/documents/${doc.id}`, { folderId: folder.id });
      const inside = await passagesOf(collection, doc.id);
      expect(
        inside.length > 0 && inside.every((p) => p.folder === folder.id),
        `after the move: ${JSON.stringify(inside.map((p) => p.folder))}`,
      );
      // Search through the real flow: only the moved document's passages, and nothing from an empty folder.
      const hits = await call(
        token,
        'GET',
        `/v1/workspaces/${slug}/passages?query=notes&minScore=0&limit=20&folderId=${folder.id}`,
      );
      expect(
        hits.data.length > 0 && hits.data.every((h: { documentId: string }) => h.documentId === doc.id),
        `search in the folder: ${JSON.stringify(hits.data.map((h: { documentId: string }) => h.documentId))}`,
      );
      const empty = await call(token, 'POST', `/v1/workspaces/${slug}/folders`, { name: 'Empty' });
      const none = await call(
        token,
        'GET',
        `/v1/workspaces/${slug}/passages?query=notes&minScore=0&folderId=${empty.id}`,
      );
      expect(none.data.length === 0, `search in an empty folder found ${none.data.length}`);
      await call(token, 'DELETE', `/v1/workspaces/${slug}/folders/${folder.id}`);
      const out = await passagesOf(collection, doc.id);
      expect(
        out.every((p) => p.folder === undefined),
        `after deleting the folder: ${JSON.stringify(out.map((p) => p.folder))}`,
      );
      const again = await call(token, 'GET', `/v1/workspaces/${slug}/documents/${doc.id}`);
      expect(again.folderId === null, `document still in folder ${again.folderId}`);
    },
  );

  await step('deleted the workspace, its Chroma collection is gone', async () => {
    await call(token, 'DELETE', `/v1/workspaces/${slug}`);
    const res = await chroma(`/collections/${collection}`);
    expect(res.status === 404, `expected Chroma 404 for ${collection}, got ${res.status}`);
  });

  console.log('Smoke test passed.');
}

main().catch((err) => {
  console.error(err instanceof CheckFailed ? `FAIL ${err.message}` : err);
  process.exit(1);
});
