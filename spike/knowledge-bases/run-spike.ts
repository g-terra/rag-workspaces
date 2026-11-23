// Spike: can Langflow 1.13.3's native knowledge bases (Postgres or SQLite) replace our
// Chroma components? Checks each question in RESULTS.md against the running stack and
// writes results/results-<backend>.json + results/summary-<backend>.md.
//
//   ./up.sh && node run-spike.ts   (SPIKE_BACKEND=sqlite for the SQLite backend)
//
// Env (defaults target the stand-in model server, poc/standin/server.ts):
//   SPIKE_EMBED_MODEL=standin-embed-a                  embedding model loaded in LM Studio
//   SPIKE_MODEL_BASE=http://host.docker.internal:1234  OpenAI-compatible server as Langflow sees it
//   SPIKE_MODEL_SERVER_LOG=http://localhost:1234/_log  stand-in request log; set empty for LM Studio

import { mkdir, writeFile } from 'node:fs/promises';
import {
  LANGFLOW_URL, bearer, createApiKey, login, outputsByComponent, readEnvFile, runFlow, upsertFlow, type Tweaks,
} from '../../poc/client/lib.ts';

const EMBED_MODEL = process.env.SPIKE_EMBED_MODEL ?? 'standin-embed-a';
const MODEL_BASE = process.env.SPIKE_MODEL_BASE ?? 'http://host.docker.internal:1234';
const MODEL_LOG = process.env.SPIKE_MODEL_SERVER_LOG ?? 'http://localhost:1234/_log';
const KB = { ouc: 'ws_spike_ouc', personal: 'ws_spike_personal' };
// postgres (default when PGVECTOR_CONNECTION_STRING is set) or sqlite (a file per KB in Langflow's volume).
const BACKEND = process.env.SPIKE_BACKEND ?? 'postgres';
// SQLite defaults to L2 distance; cosine makes its scores match Postgres (which is always cosine).
const BACKEND_CONFIG = BACKEND === 'sqlite' ? { metric: 'cosine' } : {};

// ---- recording ------------------------------------------------------------------------------------
type Check = { question: string; check: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(question: string, check: string, pass: boolean, detail: unknown) {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  checks.push({ question, check, pass, detail: d });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${question}] ${check}${pass ? '' : `\n      ${d}`}`);
}
async function attempt(question: string, check: string, fn: () => Promise<[boolean, unknown]>) {
  try {
    const [pass, detail] = await fn();
    record(question, check, pass, detail);
  } catch (err) {
    record(question, check, false, String(err).slice(0, 400));
  }
}

// ---- Langflow helpers -----------------------------------------------------------------------------
const env = await readEnvFile(new URL('./.env', import.meta.url));
const token = await login(env.LANGFLOW_SUPERUSER ?? 'admin', env.LANGFLOW_SUPERUSER_PASSWORD);
const admin = bearer(token);
const apiKey = await createApiKey(token, `kb-spike-${Date.now()}`);

async function api(auth: Record<string, string>, method: string, path: string, body?: unknown) {
  const res = await fetch(`${LANGFLOW_URL}/api/v1${path}`, {
    method, headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

/** Set a user variable (create, or update in place when it exists). */
async function setVariable(auth: Record<string, string>, name: string, value: string, type: 'Generic' | 'Credential') {
  const existing = (await api(auth, 'GET', '/variables/')).body.find?.((v: any) => v.name === name);
  if (existing) return api(auth, 'PATCH', `/variables/${existing.id}`, { id: existing.id, name, value });
  return api(auth, 'POST', '/variables/', { name, value, type, default_fields: [] });
}

async function kbChunks(auth: Record<string, string>, kb: string): Promise<any[]> {
  const r = await api(auth, 'GET', `/knowledge_bases/${kb}/chunks?limit=100`);
  if (r.status !== 200) throw new Error(`chunks ${kb}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.chunks;
}
const sourceMeta = (c: any) => JSON.parse(c.metadata?.source_metadata ?? '{}');

async function modelLog(): Promise<any[] | null> {
  if (!MODEL_LOG) return null;
  try { return await (await fetch(MODEL_LOG)).json(); } catch { return null; }
}

// ---- flows ----------------------------------------------------------------------------------------
// Built the same way as poc/client/build-flows.ts: templates come from the running Langflow, and node
// ids are fixed because the API addresses tweaks by node id.
const all: Record<string, Record<string, any>> = await (await fetch(`${LANGFLOW_URL}/api/v1/all`, { headers: admin })).json();
function component(key: string): any {
  for (const cat of Object.values(all)) if (cat && typeof cat === 'object' && key in cat) return structuredClone(cat[key]);
  throw new Error(`component ${key} not found`);
}
type Node = { id: string; type: 'genericNode'; position: { x: number; y: number }; data: any };
function node(id: string, key: string, x: number, values: Record<string, unknown> = {}): Node {
  const def = component(key);
  for (const [field, value] of Object.entries(values)) {
    if (!def.template[field]) throw new Error(`${key} has no field ${field}`);
    def.template[field].value = value;
    def.template[field].load_from_db = false;
  }
  return { id, type: 'genericNode', position: { x, y: 0 }, data: { id, type: key, node: def, showNode: true } };
}
const enc = (o: object) => JSON.stringify(o).replace(/"/g, 'œ');
function edge(src: Node, output: string, dst: Node, field: string) {
  const out = src.data.node.outputs.find((o: any) => o.name === output);
  if (!out) throw new Error(`${src.id} has no output ${output}`);
  const input = dst.data.node.template[field];
  const sourceHandle = { dataType: src.data.type, id: src.id, name: output, output_types: out.types };
  const targetHandle = { fieldName: field, id: dst.id, inputTypes: input.input_types ?? [], type: input.type };
  return {
    id: `reactflow__edge-${src.id}${enc(sourceHandle)}-${dst.id}${enc(targetHandle)}`,
    source: src.id, target: dst.id, sourceHandle: enc(sourceHandle), targetHandle: enc(targetHandle),
    data: { sourceHandle, targetHandle },
  };
}
/** The Knowledge component shows one output per mode; keep only the one the flow wires. */
function knowledge(id: string, x: number, mode: 'Ingest' | 'Retrieve', values: Record<string, unknown>): Node {
  const n = node(id, 'Knowledge', x, { mode, ...values });
  const keep = mode === 'Ingest' ? 'dataframe_output' : 'retrieve_data';
  n.data.node.outputs = n.data.node.outputs.filter((o: any) => o.name === keep);
  for (const f of ['search_query', 'top_k', 'include_metadata', 'metadata_filter']) n.data.node.template[f].show = mode === 'Retrieve';
  return n;
}
const flowOf = (id: string, name: string, nodes: Node[], edges: any[]) =>
  ({ id, name, endpoint_name: name, description: 'kb spike', data: { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.8 } } });

// Ingest: our page-aware loader -> built-in Split Text -> native Knowledge (Ingest). The identifier
// columns (text + document_id) form the dedup hash, so the same text in two documents is kept twice.
const loader = node('Loader', 'ext:rag_workspaces:WorkspaceDocumentLoader@extra', 0);
const split = node('Split', 'SplitText', 350, { chunk_size: 300, chunk_overlap: 40, separator: ' ' });
const kbIngest = knowledge('Knowledge', 700, 'Ingest', {
  column_config: [
    { column_name: 'text', vectorize: true, identifier: true },
    { column_name: 'document_id', vectorize: false, identifier: true },
  ],
});
const ingestFlow = flowOf('7b1e0c2a-5f3d-4e61-8a90-6b0c1d2e3f01', 'kb-spike-ingest', [loader, split, kbIngest],
  [edge(loader, 'pages', split, 'data_inputs'), edge(split, 'dataframe', kbIngest, 'input_df')]);

// Retrieve: question -> native Knowledge (Retrieve). The Knowledge node is the flow's output.
const chatIn = node('ChatInput', 'ChatInput', 0, { should_store_message: false });
const kbRetrieve = knowledge('Knowledge', 350, 'Retrieve', { top_k: 5, include_metadata: true });
const toJson = node('ToJson', 'TypeConverterComponent', 700, { output_type: 'JSON' });
toJson.data.node.outputs = toJson.data.node.outputs.filter((o: any) => o.name === 'data_output');
const passages = node('ChatOutput-passages', 'ChatOutput', 1050, { should_store_message: false, clean_data: false });
const retrieveFlow = flowOf('7b1e0c2a-5f3d-4e61-8a90-6b0c1d2e3f02', 'kb-spike-retrieve', [chatIn, kbRetrieve, toJson, passages],
  [edge(chatIn, 'message', kbRetrieve, 'search_query'), edge(kbRetrieve, 'retrieve_data', toJson, 'input_data'),
   edge(toJson, 'data_output', passages, 'input_value')]);

// Delete: this spike's small component over the backend's delete_by (no native way, see Q3).
const del = node('Delete', 'ext:kb_spike:KnowledgeDocumentDelete@extra', 0);
const delOut = node('ChatOutput-result', 'ChatOutput', 350, { should_store_message: false, clean_data: false });
const deleteFlow = flowOf('7b1e0c2a-5f3d-4e61-8a90-6b0c1d2e3f03', 'kb-spike-delete', [del, delOut],
  [edge(del, 'result', delOut, 'input_value')]);

for (const f of [ingestFlow, retrieveFlow, deleteFlow]) await upsertFlow(admin, f);

async function ingest(kb: string, file: string, documentId: string, folder: string) {
  const tweaks: Tweaks = {
    Loader: { file_path: file, document_id: documentId },
    Knowledge: { knowledge_base: kb, metadata_json: JSON.stringify({ document_id: documentId, folder }) },
  };
  return runFlow(apiKey, 'kb-spike-ingest', { input_value: '', tweaks });
}

/** Run the retrieve flow and return the rows the Knowledge node produced. */
async function retrieve(kb: string, query: string, extra: Record<string, unknown> = {}): Promise<any[]> {
  const run = await runFlow(apiKey, 'kb-spike-retrieve', {
    input_value: query, output_type: 'any', tweaks: { Knowledge: { knowledge_base: kb, ...extra } },
  });
  const out = outputsByComponent(run)['ChatOutput-passages'];
  // Langflow hands structured output back as ```json fenced text (poc/RESULTS.md).
  const text: string = out?.results?.message?.text ?? '';
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '') || 'null');
  const rows = Array.isArray(parsed) ? parsed : parsed?.results;
  if (!Array.isArray(rows)) throw new Error(`no rows in output: ${JSON.stringify(out ?? run).slice(0, 400)}`);
  return rows;
}

// ---- setup ----------------------------------------------------------------------------------------
// LM Studio is reached through Langflow's built-in "OpenAI Compatible" provider, configured per user.
await setVariable(admin, 'OPENAI_COMPATIBLE_BASE_URL', `${MODEL_BASE}/v1`, 'Generic');
await setVariable(admin, 'OPENAI_COMPATIBLE_API_KEY', 'lm-studio', 'Credential');
for (const kb of Object.values(KB)) await api(admin, 'DELETE', `/knowledge_bases/${kb}`);
if (MODEL_LOG) await fetch(MODEL_LOG, { method: 'DELETE' }).catch(() => undefined);

// ---- 1. one knowledge base per workspace, created over REST -----------------------------------------
const Q1 = '1. create a KB per workspace';
for (const [ws, kb] of Object.entries(KB)) {
  await attempt(Q1, `POST /knowledge_bases creates ${kb} (API key auth)`, async () => {
    const r = await api({ 'x-api-key': apiKey }, 'POST', '/knowledge_bases/', {
      name: kb, embedding_provider: 'OpenAI Compatible', embedding_model: EMBED_MODEL, backend_type: BACKEND,
      backend_config: BACKEND_CONFIG,
    });
    return [r.status === 201 && r.body.backend_type === BACKEND, { ws, status: r.status, backend: r.body.backend_type }];
  });
}
await attempt(Q1, 'creating the same name again is a 409', async () => {
  const r = await api(admin, 'POST', '/knowledge_bases/', { name: KB.ouc, embedding_provider: 'OpenAI Compatible', embedding_model: EMBED_MODEL });
  return [r.status === 409, r];
});
await attempt(Q1, `both KBs are listed on the ${BACKEND} backend`, async () => {
  const list = (await api(admin, 'GET', '/knowledge_bases/')).body;
  const ours = list.filter((k: any) => Object.values(KB).includes(k.dir_name));
  return [ours.length === 2 && ours.every((k: any) => k.backend_type === BACKEND), ours.map((k: any) => k.dir_name)];
});

// ---- 2. pick the KB per request with a tweak --------------------------------------------------------
const Q2 = '2. pick the KB per request';
await attempt(Q2, 'ingest flow writes into the KB named by the tweak', async () => {
  await ingest(KB.ouc, 'ouc/cos512-notes.pdf', 'doc-pdf', 'cos512');
  await ingest(KB.ouc, 'ouc/langflow-tips.md', 'doc-md', 'tips');
  await ingest(KB.personal, 'personal/recipes.txt', 'doc-recipes', 'kitchen');
  const ouc = (await kbChunks(admin, KB.ouc)).map((c) => sourceMeta(c).document_id);
  const personal = (await kbChunks(admin, KB.personal)).map((c) => sourceMeta(c).document_id);
  const pass = ouc.length > 0 && personal.length > 0 && !ouc.includes('doc-recipes') && personal.every((d) => d === 'doc-recipes');
  return [pass, { ouc: [...new Set(ouc)], personal: [...new Set(personal)] }];
});
await attempt(Q2, 'retrieve flow searches only the KB named by the tweak', async () => {
  const a = await retrieve(KB.personal, 'pancake recipe');
  const b = await retrieve(KB.ouc, 'pancake recipe');
  const pass = a.length > 0 && a.every((r) => r.file_name === 'recipes.txt' || r.document_id === 'doc-recipes')
    && b.every((r) => r.document_id !== 'doc-recipes');
  return [pass, { personal: a.map((r) => r.document_id), ouc: b.map((r) => r.document_id) }];
});
await attempt(Q2, 'an unknown KB name in the tweak fails the run', async () => {
  try {
    await retrieve('ws_does_not_exist', 'anything');
    return [false, 'run succeeded'];
  } catch (err) {
    return [true, String(err).slice(0, 200)];
  }
});

// ---- 3. delete one document's chunks ----------------------------------------------------------------
const Q3 = '3. delete one document';
await attempt(Q3, 'a REST route deletes chunks by document', async () => {
  const tries = [
    await api(admin, 'DELETE', `/knowledge_bases/${KB.ouc}/chunks?document_id=doc-md`),
    await api(admin, 'DELETE', `/knowledge_bases/${KB.ouc}/documents/doc-md`),
  ];
  const left = (await kbChunks(admin, KB.ouc)).filter((c) => sourceMeta(c).document_id === 'doc-md').length;
  return [left === 0, { statuses: tries.map((t) => t.status), chunksLeft: left }];
});
await attempt(Q3, 'the Knowledge component has a delete mode', async () => {
  const modes = component('Knowledge').template.mode.options;
  return [modes.some((m: string) => /delete/i.test(m)), { modes }];
});
await attempt(Q3, 'workaround: a small component deletes exactly one document', async () => {
  const count = async (kb: string, doc: string) => (await kbChunks(admin, kb)).filter((c) => c.metadata.document_id === doc).length;
  const before = { md: await count(KB.ouc, 'doc-md'), pdf: await count(KB.ouc, 'doc-pdf'), recipes: await count(KB.personal, 'doc-recipes') };
  await runFlow(apiKey, 'kb-spike-delete', { input_value: '', tweaks: { Delete: { knowledge_base: KB.ouc, document_id: 'doc-md' } } });
  const after = { md: await count(KB.ouc, 'doc-md'), pdf: await count(KB.ouc, 'doc-pdf'), recipes: await count(KB.personal, 'doc-recipes') };
  const pass = before.md > 0 && after.md === 0 && after.pdf === before.pdf && after.recipes === before.recipes;
  return [pass, { before, after }];
});
await attempt(Q3, 'deleting a whole KB (workspace delete) works', async () => {
  const tmp = 'ws_spike_tmp';
  await api(admin, 'POST', '/knowledge_bases/', { name: tmp, embedding_provider: 'OpenAI Compatible', embedding_model: EMBED_MODEL });
  const r = await api(admin, 'DELETE', `/knowledge_bases/${tmp}`);
  const gone = (await api(admin, 'GET', `/knowledge_bases/${tmp}`)).status === 404;
  return [r.status === 200 && gone, { status: r.status, gone }];
});

// ---- 4. what retrieval returns ----------------------------------------------------------------------
const Q4 = '4. scores, filter, pages, dedup';
let rows: any[] = [];
await attempt(Q4, 'results carry a score, best first', async () => {
  rows = await retrieve(KB.ouc, 'citations with page numbers');
  // Both backends report -(cosine distance), in [-2, 0]; 1 + score is the cosine similarity.
  const scores = rows.map((r) => r._score);
  const pass = scores.length > 0 && scores.every((s) => typeof s === 'number' && s >= -2 && s <= 0)
    && scores.every((s, i) => i === 0 || s <= scores[i - 1]);
  return [pass, { scores, similarity: scores.map((s) => Number((1 + s).toFixed(3))) }];
});
await attempt(Q4, 'results carry page number and document id (flow ingest)', async () => {
  const pdf = rows.filter((r) => r.document_id === 'doc-pdf');
  const pass = pdf.length > 0 && pdf.every((r) => Number(r.page) >= 1);
  return [pass, pdf.map((r) => ({ page: r.page, document_id: r.document_id, filename: r.filename }))];
});
await attempt(Q4, 'metadata filter limits results to one folder', async () => {
  const filtered = await retrieve(KB.ouc, 'Langflow tweaks', { metadata_filter: JSON.stringify({ folder: 'cos512' }) });
  const folders = filtered.map((r) => JSON.parse(r.source_metadata ?? '{}').folder);
  return [filtered.length > 0 && folders.every((f) => f === 'cos512'), { folders }];
});
await attempt(Q4, 're-ingesting the same document adds no chunks', async () => {
  const before = (await kbChunks(admin, KB.ouc)).length;
  await ingest(KB.ouc, 'ouc/cos512-notes.pdf', 'doc-pdf', 'cos512');
  const after = (await kbChunks(admin, KB.ouc)).length;
  return [before === after, { before, after }];
});
await attempt(Q4, 'the same file under another document id is stored again', async () => {
  const before = (await kbChunks(admin, KB.ouc)).length;
  await ingest(KB.ouc, 'ouc/cos512-notes.pdf', 'doc-pdf-copy', 'cos512');
  const after = (await kbChunks(admin, KB.ouc)).length;
  return [after > before, { before, after }];
});
await attempt(Q4, 'filter still finds a match ranked below the top 4 x top_k', async () => {
  // Except on SQLite, the filter is applied after the search, to the best 4 x top_k chunks only.
  await ingest(KB.ouc, 'ouc/langflow-tips.md', 'doc-tips', 'tips');
  const r = await retrieve(KB.ouc, 'evaluation faithfulness citations page numbers reader verify claim', {
    top_k: 1, metadata_filter: JSON.stringify({ folder: 'tips' }),
  });
  return [r.length === 1, { returned: r.length, chunksInKb: (await kbChunks(admin, KB.ouc)).length }];
});
await attempt(Q4, 'REST file upload keeps page numbers', async () => {
  // Langflow's own upload route (the UI path) instead of our loader.
  const form = new FormData();
  const { readFile } = await import('node:fs/promises');
  const pdf = await readFile(new URL('../../poc/samples/ouc/cos512-notes.pdf', import.meta.url));
  form.append('files', new Blob([pdf], { type: 'application/pdf' }), 'cos512-notes.pdf');
  form.append('metadata', JSON.stringify({ document_id: 'doc-rest' }));
  await fetch(`${LANGFLOW_URL}/api/v1/knowledge_bases/${KB.personal}/ingest`, { method: 'POST', headers: admin, body: form });
  let chunks: any[] = [];
  for (let i = 0; i < 20 && chunks.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    chunks = (await kbChunks(admin, KB.personal)).filter((c) => sourceMeta(c).document_id === 'doc-rest');
  }
  const keys = [...new Set(chunks.flatMap((c) => Object.keys(c.metadata)))];
  return [chunks.length > 0 && keys.includes('page'), { chunks: chunks.length, metadataKeys: keys }];
});

// ---- 5. LM Studio embeddings ------------------------------------------------------------------------
const Q5 = '5. LM Studio embeddings';
await attempt(Q5, 'built-in OpenAI Compatible provider embeds via LM Studio', async () => {
  const log = await modelLog();
  if (!log) return [true, 'no request log (real LM Studio): ingest and retrieve above are the evidence'];
  const emb = log.filter((e) => e.path === '/v1/embeddings');
  const pass = emb.length > 0 && emb.every((e) => !e.error && e.model === EMBED_MODEL);
  return [pass, { requests: emb.length, errors: emb.filter((e) => e.error).map((e) => e.error), models: [...new Set(emb.map((e) => e.model))] }];
});

// ---- 6. ownership -----------------------------------------------------------------------------------
const Q6 = '6. per-user ownership';
const other = `kb-spike-user-${Date.now()}`;
const otherPassword = `pw-${crypto.randomUUID()}`;
await attempt(Q6, "another Langflow user can't see or read the KBs", async () => {
  const created = await api({}, 'POST', '/users/', { username: other, password: otherPassword });
  await api(admin, 'PATCH', `/users/${created.body.id}`, { is_active: true });
  const otherAuth = bearer(await login(other, otherPassword));
  const list = (await api(otherAuth, 'GET', '/knowledge_bases/')).body;
  const read = await api(otherAuth, 'GET', `/knowledge_bases/${KB.ouc}/chunks`);
  const pass = Array.isArray(list) && !list.some((k: any) => Object.values(KB).includes(k.dir_name)) && read.status >= 400;
  await api(admin, 'DELETE', `/users/${created.body.id}`);
  return [pass, { visible: list.map?.((k: any) => k.dir_name), readStatus: read.status }];
});

// ---- report ---------------------------------------------------------------------------------------
const version = (await api(admin, 'GET', '/version')).body;
const summary = Object.entries(
  checks.reduce<Record<string, Check[]>>((acc, c) => ((acc[c.question] ??= []).push(c), acc), {}),
).map(([q, cs]) => ({ question: q, pass: cs.every((c) => c.pass), passed: cs.filter((c) => c.pass).length, total: cs.length }));
const meta = { ranAt: new Date().toISOString(), langflow: version.version, backend: BACKEND, embedModel: EMBED_MODEL, modelServer: MODEL_LOG ? 'stand-in' : 'external' };
await mkdir(new URL('./results/', import.meta.url), { recursive: true });
await writeFile(new URL(`./results/results-${BACKEND}.json`, import.meta.url), JSON.stringify({ meta, summary, checks }, null, 2));
const md = [
  `# Knowledge base spike run ${meta.ranAt}`, '', `Langflow ${meta.langflow} · backend: ${BACKEND} · model server: ${meta.modelServer} · embeddings: ${EMBED_MODEL}`, '',
  '| Question | Result |', '|---|---|',
  ...summary.map((s) => `| ${s.question} | ${s.pass ? 'PASS' : 'FAIL'} (${s.passed}/${s.total}) |`), '',
  '| Check | Result | Detail |', '|---|---|---|',
  ...checks.map((c) => `| ${c.check} | ${c.pass ? 'PASS' : 'FAIL'} | \`${c.detail.replace(/\|/g, '\\|').slice(0, 300)}\` |`), '',
].join('\n');
await writeFile(new URL(`./results/summary-${BACKEND}.md`, import.meta.url), md);
console.log('\n' + summary.map((s) => `${s.pass ? 'PASS' : 'FAIL'}  ${s.question} (${s.passed}/${s.total})`).join('\n'));
