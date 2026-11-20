// Dev tool: generate flows/*.json from the component templates of a running
// Langflow, so the JSON matches the pinned version exactly. Node ids are fixed
// (e.g. "Embeddings", "Search") because the API addresses tweaks by node id.
// Chat Input/Output ids must keep the "ChatOutput-..." prefix: Langflow derives a
// node's kind from the text before the first '-', and LLM streaming only turns on
// when the model is wired to a node whose id says ChatOutput.
//
//   node client/build-flows.ts        (needs the stack up and .env present)
//
// The generated JSON is committed; normal setup only imports it (bootstrap.ts).

import { writeFile } from 'node:fs/promises';
import { LANGFLOW_URL, bearer, login, readEnvFile } from './lib.ts';

const env = await readEnvFile();
const token = await login(env.LANGFLOW_SUPERUSER ?? 'admin', env.LANGFLOW_SUPERUSER_PASSWORD);
const all: Record<string, Record<string, any>> = await (await fetch(`${LANGFLOW_URL}/api/v1/all`, { headers: bearer(token) })).json();

function component(key: string): any {
  for (const cat of Object.values(all)) if (cat && typeof cat === 'object' && key in cat) return structuredClone(cat[key]);
  throw new Error(`component ${key} not found`);
}

// Defaults every workspace starts from; the API overrides them per request with tweaks.
const MODEL_BASE = 'http://host.docker.internal:1234/v1';
const DUMMY_KEY = 'lm-studio';

const ext = (name: string) => `ext:rag_workspaces:${name}@extra`;

type Node = { id: string; type: 'genericNode'; position: { x: number; y: number }; data: any };
type Edge = Record<string, any>;

function node(id: string, key: string, x: number, y: number, values: Record<string, unknown> = {}, dataType?: string): Node {
  const def = component(key);
  for (const [field, value] of Object.entries(values)) {
    if (!def.template[field]) throw new Error(`${key} has no field ${field}`);
    def.template[field].value = value;
    def.template[field].load_from_db = false;
  }
  return { id, type: 'genericNode', position: { x, y }, data: { id, type: dataType ?? key, node: def, showNode: true } };
}

const enc = (o: object) => JSON.stringify(o).replace(/"/g, 'œ');

function edge(src: Node, output: string, dst: Node, field: string): Edge {
  const out = src.data.node.outputs.find((o: any) => o.name === output);
  if (!out) throw new Error(`${src.id} has no output ${output}`);
  const input = dst.data.node.template[field];
  if (!input) throw new Error(`${dst.id} has no input ${field}`);
  const sourceHandle = { dataType: src.data.type, id: src.id, name: output, output_types: out.types };
  const targetHandle = { fieldName: field, id: dst.id, inputTypes: input.input_types ?? [], type: input.type };
  return {
    id: `reactflow__edge-${src.id}${enc(sourceHandle)}-${dst.id}${enc(targetHandle)}`,
    source: src.id, target: dst.id,
    sourceHandle: enc(sourceHandle), targetHandle: enc(targetHandle),
    data: { sourceHandle, targetHandle }, animated: false, className: '',
  };
}

// Custom component: the built-in OpenAI Embeddings one can't talk to LM Studio (see RESULTS.md).
const embeddings = (x: number, y: number) => node('Embeddings', ext('LMStudioEmbeddings'), x, y, {
  base_url: MODEL_BASE, model: 'standin-embed-a', api_key: DUMMY_KEY,
});
const chatInput = (x: number, y: number) => node('ChatInput', 'ChatInput', x, y, { should_store_message: false });
const chatOutput = (id: string, x: number, y: number, store = false) =>
  node(id, 'ChatOutput', x, y, { should_store_message: store, clean_data: false });

function flow(id: string, name: string, endpoint: string, description: string, nodes: Node[], edges: Edge[]) {
  return { id, name, endpoint_name: endpoint, description, data: { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.8 } } };
}

// ---- ingest: load -> split -> embed + upsert into the workspace collection ----
const loader = node('Loader', ext('WorkspaceDocumentLoader'), 0, 0);
const split = node('Split', 'SplitText', 350, 0, { chunk_size: 400, chunk_overlap: 60, separator: ' ' });
const upsert = node('Upsert', ext('ChromaWorkspaceUpsert'), 700, 0);
const ingestOut = chatOutput('ChatOutput-result', 1050, 0);
const ingestEmb = embeddings(350, 300);
const ingest = flow('5d3c6a0e-7f4b-4c55-9a51-0a1b2c3d4e01', 'rag-ingest', 'rag-ingest',
  'Load one document, split, embed and upsert into the workspace collection. Tweak Loader, Upsert, Embeddings, Split.',
  [loader, split, upsert, ingestOut, ingestEmb],
  [edge(loader, 'pages', split, 'data_inputs'), edge(split, 'dataframe', upsert, 'chunks'),
   edge(ingestEmb, 'embeddings', upsert, 'embedding'), edge(upsert, 'result', ingestOut, 'input_value')]);

// ---- retrieve: question -> structured passages ----
const rIn = chatInput(0, 0);
const rEmb = embeddings(0, 300);
const rSearch = node('Search', ext('ChromaWorkspaceSearch'), 350, 0);
const rOut = chatOutput('ChatOutput-passages', 700, 0);
const retrieve = flow('5d3c6a0e-7f4b-4c55-9a51-0a1b2c3d4e02', 'rag-retrieve', 'rag-retrieve',
  'Return the top passages for a question as JSON (text, score, document_id, page). Tweak Search and Embeddings.',
  [rIn, rEmb, rSearch, rOut],
  [edge(rIn, 'message', rSearch, 'search_query'), edge(rEmb, 'embeddings', rSearch, 'embedding'),
   edge(rSearch, 'passages', rOut, 'input_value')]);

// ---- answer: question -> retrieve -> prompt -> LLM (streamable) + passages for citations ----
const aIn = chatInput(0, 0);
const aEmb = embeddings(0, 300);
const aSearch = node('Search', ext('ChromaWorkspaceSearch'), 350, 0);
const prompt = node('Prompt', 'Prompt Template', 700, 0, {
  template: 'Answer the question using only the context. Cite passages as [n].\n\nContext:\n{context}\n\nQuestion: {question}\n\nAnswer:',
}, 'Prompt');
for (const v of ['context', 'question']) {
  prompt.data.node.template[v] = {
    advanced: false, display_name: v, dynamic: false, field_type: 'str', fileTypes: [], file_path: '', info: '',
    input_types: ['Message'], list: false, load_from_db: false, multiline: true, name: v, placeholder: '',
    required: false, show: true, title_case: false, type: 'str', value: '',
  };
}
prompt.data.node.custom_fields = { template: ['context', 'question'] };
// Custom component: provider (lmstudio | openai | anthropic | gemini) is a per-request tweak.
const llm = node('LLM', ext('WorkspaceChatModel'), 1050, 0, {
  provider: 'lmstudio', model_name: 'standin-chat-a', api_key: DUMMY_KEY, stream: true, temperature: 0.2,
});
const aOut = chatOutput('ChatOutput-answer', 1400, 0, true);
const aCites = chatOutput('ChatOutput-citations', 1050, 300);
const answer = flow('5d3c6a0e-7f4b-4c55-9a51-0a1b2c3d4e03', 'rag-answer', 'rag-answer',
  'Answer a question from the workspace collection, streaming tokens; Citations output carries the passages. Tweak Search, Embeddings, LLM, Prompt.',
  [aIn, aEmb, aSearch, prompt, llm, aOut, aCites],
  [edge(aIn, 'message', aSearch, 'search_query'), edge(aIn, 'message', prompt, 'question'),
   edge(aEmb, 'embeddings', aSearch, 'embedding'), edge(aSearch, 'context', prompt, 'context'),
   edge(prompt, 'prompt', llm, 'input_value'), edge(llm, 'text_output', aOut, 'input_value'),
   edge(aSearch, 'passages', aCites, 'input_value')]);

// ---- delete: remove a document's vectors ----
const del = node('Delete', ext('ChromaWorkspaceDelete'), 0, 0);
const dOut = chatOutput('ChatOutput-result', 350, 0);
const deleteFlow = flow('5d3c6a0e-7f4b-4c55-9a51-0a1b2c3d4e04', 'rag-delete', 'rag-delete',
  'Delete a document\'s vectors by document id. Tweak Delete.',
  [del, dOut], [edge(del, 'result', dOut, 'input_value')]);

for (const f of [ingest, retrieve, answer, deleteFlow]) {
  const path = new URL(`../flows/${f.name.replace('rag-', '')}.json`, import.meta.url);
  await writeFile(path, JSON.stringify(f, null, 2) + '\n');
  console.log('wrote', path.pathname);
}
