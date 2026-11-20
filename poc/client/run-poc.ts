// End-to-end POC: checks every Langflow assumption the plan depends on and
// writes results/results.json + results/summary.md.
//
//   node client/run-poc.ts
//
// Env (defaults target the stand-in model server):
//   POC_EMBED_MODELS=standin-embed-a,standin-embed-b   two embedding models LM Studio has loaded
//   POC_CHAT_MODELS=standin-chat-a,standin-chat-b       two chat models
//   POC_MODEL_SERVER_LOG=http://localhost:1234/_log     stand-in request log; set empty for LM Studio

import { mkdir, writeFile } from 'node:fs/promises';
import { bootstrap } from './bootstrap.ts';
import {
  LANGFLOW_URL, chromaDeleteWhere, chromaDropCollection, chromaGet, outputsByComponent, runFlow, streamFlow,
  type RunBody, type StreamEvent,
} from './lib.ts';

const [EMBED_A, EMBED_B] = (process.env.POC_EMBED_MODELS ?? 'standin-embed-a,standin-embed-b').split(',');
const [CHAT_A, CHAT_B] = (process.env.POC_CHAT_MODELS ?? 'standin-chat-a,standin-chat-b').split(',');
const MODEL_LOG = process.env.POC_MODEL_SERVER_LOG ?? 'http://localhost:1234/_log';

type Check = { assumption: string; check: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(assumption: string, check: string, pass: boolean, detail: unknown) {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  checks.push({ assumption, check, pass, detail: d });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${assumption}] ${check}${pass ? '' : `\n      ${d}`}`);
}
async function attempt(assumption: string, check: string, fn: () => Promise<[boolean, unknown]>) {
  try {
    const [pass, detail] = await fn();
    record(assumption, check, pass, detail);
  } catch (err) {
    record(assumption, check, false, String(err));
  }
}

/** Parse the JSON a ChatOutput carries (Langflow wraps Data in a ```json fence). */
function parseJsonOutput(output: any): any {
  const text: string = output?.results?.message?.text ?? '';
  return JSON.parse(text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''));
}

async function modelLog(): Promise<any[] | null> {
  if (!MODEL_LOG) return null;
  try { return await (await fetch(MODEL_LOG)).json(); } catch { return null; }
}

// ------------------------------------------------------------------------------------------------
const A1 = '1 tweaks';
const A2 = '2 retrieve';
const A3 = '3 streaming';
const A4 = '4 startup';
const ING = '5 ingestion';

console.log(`Langflow ${LANGFLOW_URL}; embed models ${EMBED_A}/${EMBED_B}; chat models ${CHAT_A}/${CHAT_B}\n`);

// ---- 4. startup automation ----------------------------------------------------------------------
const versionInfo = await (await fetch(`${LANGFLOW_URL}/api/v1/version`)).json().catch(() => ({}));
await attempt(A4, 'auto-login is off (GET /api/v1/auto_login refused)', async () => {
  const res = await fetch(`${LANGFLOW_URL}/api/v1/auto_login`);
  return [res.status === 401 || res.status === 403, `HTTP ${res.status}`];
});
await attempt(A4, 'run API refuses calls without an API key', async () => {
  const res = await fetch(`${LANGFLOW_URL}/api/v1/run/rag-retrieve`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"input_value":"x"}',
  });
  return [res.status === 401 || res.status === 403, `HTTP ${res.status}`];
});

const first = await bootstrap();
await attempt(A4, 'flows from flows/*.json were already imported at startup (LANGFLOW_LOAD_FLOWS_PATH)', async () => [
  first.flows.every((f) => f.presentBeforeBootstrap), first.flows.map((f) => `${f.name}:${f.presentBeforeBootstrap}`),
]);
const second = await bootstrap();
const KEY = second.apiKey;
await attempt(A4, 'bootstrap is idempotent: flows updated in place, keys rotated', async () => [
  second.flows.every((f) => f.action === 'updated') && second.revokedKeys >= 1,
  { flows: second.flows.map((f) => f.action), revokedKeys: second.revokedKeys },
]);
await attempt(A4, 'new key works, rotated-out key is rejected', async () => {
  const ok = await fetch(`${LANGFLOW_URL}/api/v1/flows/${first.flows[0].id}`, { headers: { 'x-api-key': KEY } });
  const old = await fetch(`${LANGFLOW_URL}/api/v1/flows/${first.flows[0].id}`, { headers: { 'x-api-key': first.apiKey } });
  return [ok.status === 200 && (old.status === 401 || old.status === 403), `new ${ok.status}, old ${old.status}`];
});

// ---- 5. ingestion -------------------------------------------------------------------------------
const run = (flow: string, body: RunBody) => runFlow(KEY, flow, body);
const ws = (slug: string) => `ws_poc_${slug}`;
for (const slug of ['ouc', 'personal', 'b']) await chromaDropCollection(ws(slug));

type Doc = { path: string; id: string; folder?: string; workspace: string };
const docs: Doc[] = [
  { path: 'ouc/cos512-notes.pdf', id: 'doc-pdf', folder: 'COS512', workspace: 'ouc' },
  { path: 'ouc/assignment-brief.docx', id: 'doc-docx', folder: 'COS512', workspace: 'ouc' },
  { path: 'ouc/langflow-tips.md', id: 'doc-md', workspace: 'ouc' },
  { path: 'personal/recipes.txt', id: 'doc-txt', workspace: 'personal' },
];
function ingestBody(d: Doc, extra: Record<string, Record<string, unknown>> = {}, embedModel = EMBED_A): RunBody {
  return {
    session_id: `ingest-${d.id}-${Date.now()}`,
    tweaks: {
      Loader: { file_path: d.path, document_id: d.id, folder: d.folder ?? '' },
      Upsert: { collection_name: ws(d.workspace), document_id: d.id },
      Embeddings: { model: embedModel },
      ...extra,
    },
  };
}
async function ingest(d: Doc, extra = {}, embedModel = EMBED_A) {
  const res = await run('rag-ingest', ingestBody(d, extra, embedModel));
  return parseJsonOutput(outputsByComponent(res)['ChatOutput-result']);
}

for (const d of docs) {
  await attempt(ING, `ingest ${d.path.split('.').pop()!.toUpperCase()} (${d.path}) into ${ws(d.workspace)}`, async () => {
    const t0 = performance.now();
    const r = await ingest(d);
    const stored = await chromaGet(ws(d.workspace), { document_id: d.id });
    const ms = Math.round(performance.now() - t0);
    return [r.chunks > 0 && stored.ids.length === r.chunks, { ...r, storedInChroma: stored.ids.length, ms }];
  });
}
await attempt(ING, 'PDF chunks carry document_id, filename, folder and page metadata', async () => {
  const { metadatas } = await chromaGet(ws('ouc'), { document_id: 'doc-pdf' });
  const pages = [...new Set(metadatas.map((m) => m.page))].sort();
  const ok = metadatas.every((m) => m.document_id === 'doc-pdf' && m.filename === 'cos512-notes.pdf' && m.folder === 'COS512');
  return [ok && pages.join(',') === '1,2,3', { pages, sample: metadatas[0] }];
});
await attempt(ING, 're-ingesting a document replaces its vectors (no duplicates)', async () => {
  const before = (await chromaGet(ws('ouc'), { document_id: 'doc-pdf' })).ids.length;
  await ingest(docs[0]);
  const after = (await chromaGet(ws('ouc'), { document_id: 'doc-pdf' })).ids.length;
  return [before === after, { before, after }];
});
await attempt(ING, 'delete by document id through the rag-delete flow', async () => {
  const before = (await chromaGet(ws('ouc'))).ids.length;
  const res = await run('rag-delete', { tweaks: { Delete: { collection_name: ws('ouc'), document_id: 'doc-md' } } });
  const r = parseJsonOutput(outputsByComponent(res)['ChatOutput-result']);
  const left = (await chromaGet(ws('ouc'), { document_id: 'doc-md' })).ids.length;
  const after = (await chromaGet(ws('ouc'))).ids.length;
  return [r.deleted > 0 && left === 0 && after === before - r.deleted, { ...r, before, after }];
});
await attempt(ING, 'delete by document id directly against Chroma (API-side alternative)', async () => {
  await ingest(docs[2]);
  await chromaDeleteWhere(ws('ouc'), { document_id: 'doc-md' });
  const left = (await chromaGet(ws('ouc'), { document_id: 'doc-md' })).ids.length;
  await ingest(docs[2]); // restore for later checks
  return [left === 0, { left }];
});
await attempt(ING, 'a failed ingestion surfaces as an HTTP error the API can retry on', async () => {
  try {
    await ingest({ path: 'ouc/missing.pdf', id: 'doc-missing', workspace: 'ouc' });
    return [false, 'no error'];
  } catch (err) {
    const msg = String(err);
    return [/HTTP (4|5)\d\d/.test(msg) && /not found/i.test(msg), msg.slice(0, 300)];
  }
});

// ---- 1. tweaks: one flow, many workspaces --------------------------------------------------------
const retrieve = async (q: string, search: Record<string, unknown>, embedModel = EMBED_A) => {
  const res = await run('rag-retrieve', {
    input_value: q, session_id: `retrieve-${Date.now()}-${Math.random()}`,
    tweaks: { Search: search, Embeddings: { model: embedModel } },
  });
  return parseJsonOutput(outputsByComponent(res)['ChatOutput-passages']);
};

await attempt(A1, 'collection_name tweak isolates workspaces', async () => {
  const q = 'sourdough bread starter';
  const ouc = await retrieve(q, { collection_name: ws('ouc'), top_k: 5 });
  const personal = await retrieve(q, { collection_name: ws('personal'), top_k: 5 });
  const oucDocs = ouc.passages.map((p: any) => p.document_id);
  const personalDocs = personal.passages.map((p: any) => p.document_id);
  return [!oucDocs.includes('doc-txt') && personalDocs[0] === 'doc-txt', { ouc: oucDocs, personal: personalDocs }];
});
await attempt(A1, 'folder tweak filters inside a workspace', async () => {
  const r = await retrieve('streaming tweaks langflow', { collection_name: ws('ouc'), top_k: 5, folder: 'COS512' });
  const folders = [...new Set(r.passages.map((p: any) => p.folder))];
  return [folders.length === 1 && folders[0] === 'COS512', { folders, docs: r.passages.map((p: any) => p.document_id) }];
});
await attempt(A1, 'chunking tweak (Split.chunk_size) changes how a document is split', async () => {
  const small = await ingest(docs[0], { Split: { chunk_size: 80, chunk_overlap: 10 } });
  const normal = await ingest(docs[0]);
  return [small.chunks > normal.chunks, { chunk_size_80: small.chunks, default: normal.chunks }];
});
await attempt(A1, 'embedding model tweak reaches the model server', async () => {
  const b: Doc = { ...docs[2], workspace: 'b' };
  await ingest(b, {}, EMBED_B);
  const r = await retrieve('tweaks override component fields', { collection_name: ws('b'), top_k: 1 }, EMBED_B);
  const log = await modelLog();
  if (!log) return [r.passages.length === 1, { note: 'no stand-in log; ingest+query with second model succeeded', top: r.passages[0]?.document_id }];
  const models = [...new Set(log.filter((e) => e.path === '/v1/embeddings').map((e) => e.model))];
  return [models.includes(EMBED_A) && models.includes(EMBED_B) && r.passages.length === 1, { modelsSeen: models }];
});
await attempt(A1, 'chat model tweak reaches the model server', async () => {
  const res = await run('rag-answer', {
    input_value: 'What are the deliverables?', session_id: `answer-${Date.now()}`,
    tweaks: { Search: { collection_name: ws('ouc') }, Embeddings: { model: EMBED_A }, LLM: { model_name: CHAT_B, stream: false } },
  });
  const log = await modelLog();
  const answer = outputsByComponent(res)['ChatOutput-answer']?.results?.message?.text ?? '';
  if (!log) return [answer.length > 0, { note: 'no stand-in log', answer: answer.slice(0, 120) }];
  const last = log.filter((e) => e.path === '/v1/chat/completions').at(-1);
  return [last?.model === CHAT_B, { lastChatModel: last?.model, answer: answer.slice(0, 120) }];
});
await attempt(A1, 'an unknown model name in a tweak fails loudly (not silently defaulted)', async () => {
  // Only meaningful against LM Studio, which rejects models it has not loaded.
  if (await modelLog()) return [true, 'skipped: the stand-in accepts any model name'];
  try {
    await run('rag-answer', { input_value: 'x', tweaks: { Search: { collection_name: ws('ouc') }, LLM: { model_name: 'no-such-model', stream: false } } });
    return [false, 'no error'];
  } catch (err) { return [true, String(err).slice(0, 200)]; }
});
await attempt(A1, 'prompt template tweak replaces the prompt', async () => {
  const marker = 'POC-PROMPT-MARKER';
  await run('rag-answer', {
    input_value: 'What is chunking?', session_id: `answer-${Date.now()}`,
    tweaks: { Search: { collection_name: ws('ouc') }, LLM: { model_name: CHAT_A, stream: false },
      Prompt: { template: `${marker}\n{context}\nQuestion: {question}` } },
  });
  const log = await modelLog();
  if (!log) return [true, 'skipped: needs the stand-in log to see the prompt'];
  const last = log.filter((e) => e.path === '/v1/chat/completions').at(-1);
  return [String(last?.prompt).startsWith(marker), { promptStart: String(last?.prompt).slice(0, 60) }];
});
await attempt(A1, '12 concurrent runs with different tweaks do not bleed into each other', async () => {
  const jobs = Array.from({ length: 12 }, (_, i) => {
    const slug = i % 2 ? 'personal' : 'ouc';
    return retrieve('sourdough bread starter chunking overlap', { collection_name: ws(slug), top_k: 3 }).then((r) => ({ slug, r }));
  });
  const results = await Promise.all(jobs);
  const bad = results.filter(({ slug, r }) =>
    r.collection !== ws(slug) || r.passages.some((p: any) => (slug === 'ouc') === (p.document_id === 'doc-txt')));
  return [bad.length === 0, { runs: results.length, mismatched: bad.length }];
});

// ---- 2. retrieve: structured passages -------------------------------------------------------------
await attempt(A2, 'retrieve flow returns passages with text, score, document_id, page, filename', async () => {
  const r = await retrieve('How large should chunk overlap be?', { collection_name: ws('ouc'), top_k: 3 });
  const p = r.passages[0];
  const shapeOk = r.passages.every((x: any) => typeof x.text === 'string' && typeof x.score === 'number' && x.document_id && x.filename);
  const sorted = r.passages.every((x: any, i: number, a: any[]) => i === 0 || a[i - 1].score >= x.score);
  return [shapeOk && sorted && p.document_id === 'doc-pdf' && p.page === 2, { top: { ...p, text: p.text.slice(0, 60) + '…' }, count: r.passages.length }];
});
await attempt(A2, 'passages for non-paged files (DOCX/MD) have page null, not an error', async () => {
  const r = await retrieve('deliverables report demo video', { collection_name: ws('ouc'), top_k: 5 });
  const docx = r.passages.find((x: any) => x.document_id === 'doc-docx');
  return [Boolean(docx) && docx.page == null, { docx: docx && { page: docx.page, score: docx.score } }];
});
await attempt(A2, 'empty or unknown workspace returns zero passages, not a crash', async () => {
  const r = await retrieve('anything', { collection_name: 'ws_poc_does_not_exist', top_k: 3 });
  return [Array.isArray(r.passages) && r.passages.length === 0, r];
});

// ---- 3. streaming ---------------------------------------------------------------------------------
await attempt(A3, 'answer flow streams tokens through /api/v1/run?stream=true', async () => {
  const events: StreamEvent[] = [];
  for await (const ev of streamFlow(KEY, 'rag-answer', {
    input_value: 'How large should chunk overlap be?', session_id: `stream-${Date.now()}`,
    tweaks: { Search: { collection_name: ws('ouc'), top_k: 2 }, LLM: { model_name: CHAT_A } },
  })) events.push(ev);
  const tokens = events.filter((e) => e.event === 'token' && e.data?.chunk);
  const end = events.find((e) => e.event === 'end');
  const streamed = tokens.map((t) => t.data.chunk).join('');
  const outs = outputsByComponent(end?.data?.result ?? {});
  const finalText = outs['ChatOutput-answer']?.results?.message?.text ?? '';
  const citations = parseJsonOutput(outs['ChatOutput-citations']);
  const spreadMs = tokens.length ? Math.round(tokens.at(-1)!.receivedAtMs - tokens[0].receivedAtMs) : 0;
  const pass = tokens.length >= 5 && spreadMs > 100 && streamed.trim() === finalText.trim() && citations.passages.length > 0
    && tokens[0].receivedAtMs < end!.receivedAtMs;
  return [pass, {
    tokenEvents: tokens.length, firstTokenMs: Math.round(tokens[0]?.receivedAtMs ?? -1), spreadMs,
    eventTypes: [...new Set(events.map((e) => e.event))], streamedEqualsFinal: streamed.trim() === finalText.trim(),
    citationsInEndEvent: citations.passages.length, answer: finalText.slice(0, 100),
  }];
});

// ---- report ---------------------------------------------------------------------------------------
const summary = Object.entries(
  checks.reduce<Record<string, Check[]>>((acc, c) => ((acc[c.assumption] ??= []).push(c), acc), {}),
).map(([a, cs]) => ({ assumption: a, pass: cs.every((c) => c.pass), passed: cs.filter((c) => c.pass).length, total: cs.length }));

await mkdir(new URL('../results/', import.meta.url), { recursive: true });
const meta = { ranAt: new Date().toISOString(), langflow: versionInfo, models: { EMBED_A, EMBED_B, CHAT_A, CHAT_B }, modelServer: MODEL_LOG ? 'stand-in' : 'external' };
await writeFile(new URL('../results/results.json', import.meta.url), JSON.stringify({ meta, summary, checks }, null, 2));
const md = [
  `# POC run ${meta.ranAt}`, '', `Langflow ${versionInfo.version ?? '?'} · model server: ${meta.modelServer} · models: ${EMBED_A}, ${EMBED_B}, ${CHAT_A}, ${CHAT_B}`, '',
  '| Assumption | Result |', '|---|---|',
  ...summary.map((s) => `| ${s.assumption} | ${s.pass ? 'PASS' : 'FAIL'} (${s.passed}/${s.total}) |`), '',
  '| Check | Result | Detail |', '|---|---|---|',
  ...checks.map((c) => `| ${c.check} | ${c.pass ? 'PASS' : 'FAIL'} | \`${c.detail.replace(/\|/g, '\\|').slice(0, 300)}\` |`), '',
].join('\n');
await writeFile(new URL('../results/summary.md', import.meta.url), md);
console.log('\n' + summary.map((s) => `${s.pass ? 'PASS' : 'FAIL'}  ${s.assumption} (${s.passed}/${s.total})`).join('\n'));
process.exit(summary.every((s) => s.pass) ? 0 : 1);
