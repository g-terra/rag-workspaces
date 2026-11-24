// The smoke checks, against a running smoke stack (node scripts/smoke/stack.ts up).
// Signs in through the real Keycloak, then runs the ingestion path end to end and checks what the
// ingest flow wrote into Chroma. Exits non-zero at the first failed check.
//   node scripts/smoke/check.ts
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { basename } from 'node:path';
import { compose, smokeEnv } from './stack.ts';

const env = smokeEnv();
const API = env.PUBLIC_API_URL!;
const KEYCLOAK = env.KEYCLOAK_PUBLIC_URL!;
const CHROMA = `http://127.0.0.1:${env.CHROMA_PORT}/api/v2/tenants/default_tenant/databases/default_database`;
const STANDIN = `http://127.0.0.1:${env.STANDIN_PORT}`;
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
type Passage = {
  document_id: string;
  page: number | null;
  folder?: string;
  start_seconds?: number;
  end_seconds?: number;
};

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

/**
 * GET through the local-names proxy. Node doesn't resolve *.localhost on every system, so this
 * connects to 127.0.0.1 and sends the name as the Host header, as a browser on this machine would.
 */
function viaProxy(host: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: Number(env.PROXY_PORT),
        path,
        headers: { host },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${host}${path} timed out`)));
    req.on('error', reject);
    req.end();
  });
}

/** The realm's sign-in page uses our login theme (docker/keycloak/themes), and its stylesheet loads. */
async function checkLoginTheme() {
  const keycloak = KEYCLOAK;
  const realm = 'rag-workspaces';
  // Start a sign-in as Keycloak's built-in account console would; the answer is the sign-in page.
  const auth = new URL(`${keycloak}/realms/${realm}/protocol/openid-connect/auth`);
  auth.search = new URLSearchParams({
    client_id: 'account-console',
    redirect_uri: `${keycloak}/realms/${realm}/account/`,
    response_type: 'code',
    scope: 'openid',
    code_challenge: 'x'.repeat(43),
    code_challenge_method: 'S256',
  }).toString();
  const page = await fetch(auth, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const html = await page.text();
  const css = html.match(/href="([^"]*\/login\/rag-workspaces\/css\/rag-workspaces\.css)"/)?.[1];
  expect(page.ok && css, `the sign-in page doesn't link the rag-workspaces stylesheet`);
  expect(html.includes('Ask your own material'), `the sign-in page lacks the theme's brand panel`);
  const sheet = await fetch(new URL(css, keycloak), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  expect(sheet.ok, `the theme's stylesheet answered ${sheet.status}`);
}

async function main() {
  await step('local names: the proxy reaches the admin UI, API, Keycloak and Langflow', async () => {
    const routes = [
      ['rag.localhost', '/', '<div id="root">'],
      ['api.rag.localhost', '/health', '"ok"'],
      ['auth.rag.localhost', '/realms/rag-workspaces/.well-known/openid-configuration', '"issuer"'],
      ['langflow.rag.localhost', '/health_check', '"ok"'],
    ] as const;
    for (const [host, path, expected] of routes) {
      // Keycloak reports healthy a moment before it stops answering 503 ("Bootstrap in progress").
      let res = await viaProxy(host, path);
      for (let i = 0; i < 30 && (res.status === 502 || res.status === 503); i++) {
        await new Promise((r) => setTimeout(r, 2000));
        res = await viaProxy(host, path);
      }
      expect(
        res.status === 200 && res.body.includes(expected),
        `${host}${path}: ${res.status} ${res.body.slice(0, 200)}`,
      );
    }
  });
  await step("Keycloak's sign-in page wears the admin UI's theme", checkLoginTheme);
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

  await step(
    'reindexed the workspace: search waits, then every passage is back, with the HNSW settings',
    async () => {
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
      // The rebuilt collection has the HNSW settings that keep workspace-wide search recall up
      // (COLLECTION_HNSW in apps/api/src/services/chroma.ts), not Chroma's defaults.
      const { configuration_json } = (await (await chroma(`/collections/${collection}`)).json()) as {
        configuration_json: { hnsw?: Record<string, unknown> };
      };
      const hnsw = configuration_json.hnsw ?? {};
      expect(
        hnsw.ef_search === 400 && hnsw.ef_construction === 200 && hnsw.max_neighbors === 32,
        `collection HNSW settings after reindex: ${JSON.stringify(hnsw)}`,
      );
    },
  );

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

  await step('a PDF page with a very long content stream is still read', async () => {
    const form = new FormData();
    form.append('files', new Blob([densePdf()]), 'dense.pdf');
    const { data } = (await call(token, 'POST', `/v1/workspaces/${slug}/documents`, form)) as {
      data: { document: Doc }[];
    };
    const [doc] = await waitUntilReady(token, slug, [data[0]!.document.id]);
    expect(doc!.status === 'ready', `dense.pdf: ${doc!.status} ${doc!.error ?? ''}`);
    const passages = await passagesOf(collection, doc!.id);
    expect(
      passages.some((p) => p.page === 1),
      `dense.pdf passages: ${JSON.stringify(passages)}`,
    );
  });

  await step('video and audio: a WAV is transcribed, and its passages carry start times', async () => {
    // A valid, silent WAV header; the stand-in Whisper answers any file with the same two segments.
    const wav = Buffer.alloc(44 + 1600);
    wav.write('RIFF', 0, 'latin1');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8, 'latin1');
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); // PCM
    wav.writeUInt16LE(1, 22); // mono
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36, 'latin1');
    wav.writeUInt32LE(1600, 40);
    const form = new FormData();
    form.append('files', new Blob([wav]), 'lecture.wav');
    const { data } = (await call(token, 'POST', `/v1/workspaces/${slug}/documents`, form)) as {
      data: { document: Doc }[];
    };
    const [doc] = await waitUntilReady(token, slug, [data[0]!.document.id]);
    const transcript = await call(token, 'GET', `/v1/workspaces/${slug}/documents/${doc!.id}/transcript`);
    expect(
      transcript.segments.length === 2 && transcript.segments[1].start === 3.2,
      `transcript: ${JSON.stringify(transcript)}`,
    );
    const passages = await passagesOf(collection, doc!.id);
    expect(
      passages.length > 0 && passages.every((p) => typeof p.start_seconds === 'number'),
      `passages need start_seconds: ${JSON.stringify(passages)}`,
    );
    const found = await call(
      token,
      'GET',
      `/v1/workspaces/${slug}/passages?query=chroma+embeddings+metadata`,
    );
    expect(
      found.data.some(
        (p: { documentId: string; startSeconds: number | null }) =>
          p.documentId === doc!.id && typeof p.startSeconds === 'number',
      ),
      `search did not find the transcript with its start time: ${JSON.stringify(found.data)}`,
    );
  });

  await step('embedding prefixes: pinned on the workspace and put before documents and queries', async () => {
    // EMBEDDING_PREFIXES in the smoke env gives the stand-in's model "passage: " and "query: ".
    const ws = await call(token, 'GET', `/v1/workspaces/${slug}`);
    expect(
      ws.settings.embeddingPrefixes?.document === 'passage: ' &&
        ws.settings.embeddingPrefixes?.query === 'query: ',
      `pinned prefixes: ${JSON.stringify(ws.settings.embeddingPrefixes)}`,
    );
    await fetch(`${STANDIN}/_log`, { method: 'DELETE' });
    await call(
      token,
      'POST',
      `/v1/workspaces/${slug}/documents`,
      (() => {
        const form = new FormData();
        form.append(
          'files',
          new Blob(['Prefixes tell the embedding model what a text is for.']),
          'prefixes.md',
        );
        return form;
      })(),
    ).then(({ data }) => waitUntilReady(token, slug, [data[0].document.id]));
    await call(token, 'GET', `/v1/workspaces/${slug}/passages?query=what+are+prefixes+for`);
    const seen = ((await (await fetch(`${STANDIN}/_log`)).json()) as { path: string; starts?: string[] }[])
      .filter((e) => e.path === '/v1/embeddings')
      .flatMap((e) => e.starts ?? []);
    expect(
      seen.some((t) => t.startsWith('passage: Prefixes tell')),
      `no document embedded with its prefix: ${JSON.stringify(seen)}`,
    );
    expect(
      seen.some((t) => t.startsWith('query: what are prefixes for')),
      `no query embedded with its prefix: ${JSON.stringify(seen)}`,
    );
  });

  await step('a numbered list stays in one passage with the sentence that introduces it', async () => {
    // About 1,000 characters at the default chunk size of 800: a paragraph, then a list that fits in one
    // chunk. Cutting at any space put the cut in the middle of an item.
    const intro = 'Resolution needs every formula in clausal form before it can start. '.repeat(9);
    const items = Array.from(
      { length: 6 },
      (_, i) => `${i + 1}. Step ${i + 1} of the conversion, written out in a full sentence.`,
    );
    const text = `${intro.trim()}\n\nThe conversion has six steps:\n${items.join('\n')}\n`;
    const form = new FormData();
    form.append('files', new Blob([text]), 'clausal-form.md');
    const { data } = (await call(token, 'POST', `/v1/workspaces/${slug}/documents`, form)) as {
      data: { document: Doc }[];
    };
    const [doc] = await waitUntilReady(token, slug, [data[0]!.document.id]);
    const { data: passages } = (await call(
      token,
      'GET',
      `/v1/workspaces/${slug}/documents/${doc!.id}/passages`,
    )) as { data: { text: string }[] };
    expect(
      passages.some(
        (p) => p.text.includes('The conversion has six steps:') && items.every((i) => p.text.includes(i)),
      ),
      `no passage holds the whole list: ${JSON.stringify(passages.map((p) => p.text))}`,
    );
  });

  await step(
    'hybrid search: a rare exact word finds its passage even when the meaning points elsewhere',
    async () => {
      // Ten notes share four of the query's five words; one note shares only the rare fifth word. Similarity
      // alone ranks that note last; keyword search ranks it first, and fusing the two lists keeps it.
      const form = new FormData();
      for (let i = 0; i < 10; i++) {
        form.append(
          'files',
          new Blob([
            `Note ${i}: gradient descent learning rate momentum, chapter ${i} of the optimisation unit.`,
          ]),
          `optimisation-${i}.md`,
        );
      }
      form.append('files', new Blob(['The zyxquorph lemma appears only once in this course.']), 'lemma.md');
      const { data } = (await call(token, 'POST', `/v1/workspaces/${slug}/documents`, form)) as {
        data: { document: Doc }[];
      };
      await waitUntilReady(
        token,
        slug,
        data.map((d) => d.document.id),
      );
      const lemma = data.find((d) => d.document.fileName === 'lemma.md')!.document.id;
      const found = await call(
        token,
        'GET',
        `/v1/workspaces/${slug}/passages?query=zyxquorph+momentum+momentum+momentum&limit=8&minScore=0`,
      );
      expect(
        found.data.some((p: { documentId: string }) => p.documentId === lemma),
        `the rare word's passage is not in the top 8: ${JSON.stringify(found.data.map((p: { text: string }) => p.text))}`,
      );
    },
  );

  await step("reasoning effort: the workspace's setting reaches the chat model", async () => {
    // minScore 0, so the stand-in's rough embeddings always find something and the model is asked.
    await call(token, 'PATCH', `/v1/workspaces/${slug}`, {
      settings: { reasoningEffort: 'none', minScore: 0 },
    });
    await fetch(`${STANDIN}/_log`, { method: 'DELETE' });
    const answer = await call(token, 'POST', `/v1/workspaces/${slug}/answers`, {
      question: 'What does Chroma store?',
    });
    expect(answer.status === 'complete', `answer: ${JSON.stringify(answer)}`);
    const chats = (
      (await (await fetch(`${STANDIN}/_log`)).json()) as { path: string; reasoning_effort?: string }[]
    ).filter((e) => e.path === '/v1/chat/completions');
    expect(
      chats.length > 0 && chats.every((e) => e.reasoning_effort === 'none'),
      `chat requests: ${JSON.stringify(chats)}`,
    );
  });

  await step('a question about two topics searches each part, so both topics are found', async () => {
    // Ten notes match the first part's many words; one note answers the second part. Searched as one
    // query, the second topic's few words are outweighed and its note misses the top 5.
    const form = new FormData();
    for (let i = 0; i < 10; i++) {
      form.append(
        'files',
        new Blob([
          `Schedules ${i}: gradient descent learning rate momentum warmup decay schedules in practice.`,
        ]),
        `schedules-${i}.md`,
      );
    }
    form.append(
      'files',
      new Blob(['The perceptron rule adds the misclassified input to its weights.']),
      'perceptron.md',
    );
    const { data } = (await call(token, 'POST', `/v1/workspaces/${slug}/documents`, form)) as {
      data: { document: Doc }[];
    };
    await waitUntilReady(
      token,
      slug,
      data.map((d) => d.document.id),
    );
    const perceptron = data.find((d) => d.document.fileName === 'perceptron.md')!.document.id;
    const question =
      'Which gradient descent learning rate momentum warmup decay schedules work, and how does the perceptron update its weights?';
    const found = await call(
      token,
      'GET',
      `/v1/workspaces/${slug}/passages?query=${encodeURIComponent(question)}&limit=5&minScore=0`,
    );
    expect(
      found.data.some((p: { documentId: string }) => p.documentId === perceptron),
      `the second topic's passage is not in the top 5: ${JSON.stringify(found.data.map((p: { text: string }) => p.text))}`,
    );
  });

  await step('a part with no subject of its own still finds the passage that answers it', async () => {
    // "…, and how many targets are there in most versions?" names no test. Searched alone, that part finds the
    // sales notes (they share more of its words) and the first part finds the vigilance notes. The passage that
    // answers it shares the most words with the whole question, which takes a turn after the parts.
    const form = new FormData();
    for (let i = 0; i < 3; i++) {
      form.append(
        'files',
        new Blob([`Vigilance ${i}: the Mackworth clock test measures vigilance by watching the hand.`]),
        `vigilance-${i}.md`,
      );
      form.append(
        'files',
        new Blob([`How many targets are there? Sales ${i} sets targets each quarter.`]),
        `sales-${i}.md`,
      );
    }
    form.append(
      'files',
      new Blob(['Most versions of the Mackworth clock test have 12 targets.']),
      'mackworth-targets.md',
    );
    const { data } = (await call(token, 'POST', `/v1/workspaces/${slug}/documents`, form)) as {
      data: { document: Doc }[];
    };
    await waitUntilReady(
      token,
      slug,
      data.map((d) => d.document.id),
    );
    const targets = data.find((d) => d.document.fileName === 'mackworth-targets.md')!.document.id;
    const question =
      'How does the Mackworth clock test measure vigilance, and how many targets are there in most versions?';
    const found = await call(
      token,
      'GET',
      `/v1/workspaces/${slug}/passages?query=${encodeURIComponent(question)}&limit=4&minScore=0`,
    );
    expect(
      found.data.some((p: { documentId: string }) => p.documentId === targets),
      `the answering passage is not in the top 4: ${JSON.stringify(found.data.map((p: { text: string }) => p.text))}`,
    );
  });

  await step(
    'the prompt says which citation numbers are valid, and times do not look like citations',
    async () => {
      const form = new FormData();
      form.append(
        'files',
        new Blob(['[4:00] The blorptastic epoch is one full pass.']),
        'talk.transcript.md',
      );
      const { data } = (await call(token, 'POST', `/v1/workspaces/${slug}/documents`, form)) as {
        data: { document: Doc }[];
      };
      await waitUntilReady(
        token,
        slug,
        data.map((d) => d.document.id),
      );
      await fetch(`${STANDIN}/_log`, { method: 'DELETE' });
      await call(token, 'POST', `/v1/workspaces/${slug}/answers`, {
        question: 'What is the blorptastic epoch?',
        maxPassages: 2,
      });
      const log = (await (await fetch(`${STANDIN}/_log`)).json()) as { path: string; prompt?: string }[];
      const prompt = log.find((e) => e.path === '/v1/chat/completions')?.prompt ?? '';
      expect(
        prompt.includes('The passages are numbered 1 to 2. Cite only these numbers.'),
        `no citation numbers in: ${prompt}`,
      );
      expect(prompt.includes('(4:00)') && !prompt.includes('[4:00]'), `time not rewritten in: ${prompt}`);
    },
  );

  await step('a composite workspace answers from both of its sources through rw-generate', async () => {
    const other = `${slug}-b`;
    const study = `${slug}-c`;
    await call(token, 'POST', '/v1/workspaces', {
      slug: other,
      name: 'Smoke source B',
      settings: { minScore: 0 },
    });
    try {
      const form = new FormData();
      form.append('files', new Blob(['The vector store keeps one collection per workspace.']), 'store.md');
      const { data } = (await call(token, 'POST', `/v1/workspaces/${other}/documents`, form)) as {
        data: { document: Doc }[];
      };
      await waitUntilReady(
        token,
        other,
        data.map((d) => d.document.id),
      );
      await call(token, 'POST', '/v1/workspaces', {
        slug: study,
        name: 'Smoke composite',
        kind: 'composite',
        sources: [slug, other],
      });
      const answer = await call(token, 'POST', `/v1/workspaces/${study}/answers`, {
        question: 'What does Chroma store?',
      });
      const from = new Set(answer.citations.map((c: { workspace: string }) => c.workspace));
      expect(
        answer.status === 'complete' && answer.workspace === study && from.has(slug) && from.has(other),
        `answer: ${JSON.stringify(answer)}`,
      );
      const cited = answer.citations.find((c: { workspace: string }) => c.workspace === other);
      const preview = await call(token, 'GET', `/v1/workspaces/${study}/passages/${cited.passageId}`);
      expect(preview.passage.workspace === other, `preview: ${JSON.stringify(preview)}`);
    } finally {
      await call(token, 'DELETE', `/v1/workspaces/${study}`).catch(() => undefined);
      await call(token, 'DELETE', `/v1/workspaces/${other}`);
    }
  });

  await step('a docs website is crawled into pages, cited by URL, crawled again and removed', async () => {
    const base = '/v1/workspaces/' + slug + '/sites';
    const docsUrl = 'http://standin:1234/site/docs/';
    const waitForCrawl = async (id: string) => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      for (;;) {
        const site = await call(token, 'GET', `${base}/${id}`);
        if (site.status === 'ready' || site.status === 'failed') return site;
        expect(Date.now() < deadline, `crawl still ${site.status} after ${READY_TIMEOUT_MS / 1000} s`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    const site = await call(token, 'POST', base, { url: docsUrl, maxPages: 10 });
    let crawled = await waitForCrawl(site.id);
    expect(crawled.status === 'ready', `crawl ended ${crawled.status}: ${crawled.lastError}`);
    expect(
      crawled.pages.new === 3 && crawled.documentCount === 3,
      `expected 3 new pages, got ${JSON.stringify(crawled.pages)} and ${crawled.documentCount} documents`,
    );
    const { data: all } = await call(token, 'GET', `/v1/workspaces/${slug}/documents`);
    const pages = all.filter((d: { siteId: string | null }) => d.siteId === site.id);
    expect(
      !pages.some((d: { sourceUrl: string }) => d.sourceUrl.endsWith('/private')),
      'a page robots.txt disallows was imported',
    );
    await waitUntilReady(
      token,
      slug,
      pages.map((d: Doc) => d.id),
    );
    const usage = pages.find((d: { sourceUrl: string }) => d.sourceUrl === `${docsUrl}usage`);
    expect(usage, `no page for ${docsUrl}usage: ${pages.map((d: { sourceUrl: string }) => d.sourceUrl)}`);
    const { data: passages } = await call(
      token,
      'GET',
      `/v1/workspaces/${slug}/documents/${usage.id}/passages`,
    );
    const text = passages.map((p: { text: string }) => p.text).join(' ');
    expect(/calibrate the widget sprocket/.test(text), `the page text is missing: ${text}`);
    expect(!/Sidebar navigation|Footer copyright/.test(text), `navigation or footer was kept: ${text}`);
    const hits = await call(
      token,
      'GET',
      `/v1/workspaces/${slug}/passages?query=${encodeURIComponent('calibrate widget sprocket')}&minScore=0`,
    );
    expect(
      hits.data[0]?.sourceUrl === `${docsUrl}usage`,
      `the best hit should cite ${docsUrl}usage, got ${JSON.stringify(hits.data[0])}`,
    );

    await call(token, 'POST', `${base}/${site.id}/crawl`);
    crawled = await waitForCrawl(site.id);
    expect(
      crawled.status === 'ready' &&
        crawled.pages.unchanged === 3 &&
        crawled.pages.new === 0 &&
        crawled.pages.removed === 0,
      `a second crawl of an unchanged site should change nothing: ${JSON.stringify(crawled.pages)}`,
    );

    // Langflow's SSRF guard refuses internal services: Chroma is one.
    const internal = await call(token, 'POST', base, { url: 'http://chroma:8000/docs/' });
    const refused = await waitForCrawl(internal.id);
    expect(
      refused.status === 'failed' && /SSRF|refused/i.test(refused.lastError ?? ''),
      `crawling an internal service should fail, got ${refused.status}: ${refused.lastError}`,
    );

    await call(token, 'DELETE', `${base}/${site.id}`);
    await call(token, 'DELETE', `${base}/${internal.id}`);
    const left = await call(token, 'GET', `/v1/workspaces/${slug}/documents`);
    expect(
      !left.data.some((d: { siteId: string | null }) => d.siteId === site.id),
      'removing the site left pages behind',
    );
    const gone = await chroma(`/collections/${collection}`);
    expect(gone.ok, 'the collection should still exist');
    expect(
      (await passagesOf(collection, usage.id)).length === 0,
      "the removed page's passages are still in Chroma",
    );
  });

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

/**
 * A one-page PDF whose content stream holds about 3 million tokens (a million `0 0 m` path operators)
 * after one line of text: more than pypdf parses by default ("Reached maximum number of tokens per
 * stream"), as in slide decks with drawn diagrams.
 */
function densePdf(): Buffer {
  const body = 'BT /F1 12 Tf 72 720 Td (Dense page text) Tj ET\n' + '0 0 m\n'.repeat(1_000_000);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) pdf += `${String(at).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
