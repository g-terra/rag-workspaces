# Flows: the contract between the API and Langflow

Langflow imports every `*.json` in this folder on each start (`LANGFLOW_LOAD_FLOWS_PATH`)
and updates existing flows in place, matched by their fixed `id`. The repo is the source of
truth: an edit made only in the Langflow editor is overwritten on the next restart, so export
it first (`pnpm flows:export`, M1).

The flows use the custom components in `../langflow/components/rag_workspaces/`
(Chroma over REST, document loader with page numbers, LM Studio embeddings, a chat model whose
provider is set per request). Why each exists is in `poc/RESULTS.md`.

Pinned to **Langflow 1.13.3**. Flow JSON is tied to the Langflow version: a version bump means
regenerating the flows (`node poc/client/build-flows.ts`, with the stack up; set `OUT_DIR` to write elsewhere and diff first) and rerunning the checks.

## Rules

1. **Run by endpoint name**, never by flow id: `POST /api/v1/run/<endpoint_name>`.
2. **Inputs are tweaks keyed by node id**: `{ "tweaks": { "<node id>": { "<field>": value } } }`.
   Node ids below are fixed and are part of the contract. Renaming one breaks the API.
3. **Chat input and output nodes keep the `ChatInput-` / `ChatOutput-` id prefix.** Langflow
   decides a node's kind from the text before the first `-`, and a model only streams tokens when
   it is wired to a node it recognises as a Chat Output.
4. **Structured output is fenced JSON inside a chat message** (` ```json ... ``` `). The API
   strips the fence (`parseJsonMessage` in `packages/langflow-client`).
5. **Always send a `session_id`** (conversation id, or a fresh id per request).
6. **Provider keys never live in Langflow's environment.** The API sends `provider`, `model_name`,
   `api_key` and `base_url` as tweaks on the `LLM` node. Langflow refuses to send a key that
   matches one of its own environment values to a non-OpenAI host.
7. **The API chooses `collection_name`** (`ws_<slug>`). It never comes from a caller.
8. **A component whose outputs feed two different nodes sets `group_outputs=True` on them.**
   Langflow draws outputs that don't as a single dropdown handle, pins it to the first output when
   the flow opens in the editor, and removes the other output's connections ("Some connections were
   removed because they were invalid"). `apps/api/src/flows.test.ts` checks every committed flow.
9. **No legacy components.** The editor marks them "Legacy" and Langflow can drop them in a later
   version; the same test checks for them.

## Flows

The API's list of names is `apps/api/src/flows.ts`; `/ready` fails if one is missing.

### `rw-ingest`: load, split, embed and store one file

| Node | Tweak fields the API sets |
|---|---|
| `Loader` | `file_path` (relative to `/data/uploads`), `document_id`, `filename`, `folder` (the folder id, empty at the top level) |
| `Split` | `chunk_size`, `chunk_overlap` (our `WorkspaceTextSplitter`: cuts at paragraph, then line, then sentence breaks, so a list that fits stays in one chunk) |
| `Embeddings` | `model`, `base_url`, `document_prefix`, `query_prefix` (the workspace's pinned prefixes; empty for none) |
| `Upsert` | `collection_name`, `document_id` |

Output `ChatOutput-result`: `{ collection, document_id, chunks, pages }` (`pages` is `null` for non-PDFs). Re-ingesting a document deletes its
vectors first, so retries never duplicate. Vector ids are `<document_id>:<chunk index>`, with metadata
`document_id`, `filename`, `folder`, `chunk_index`, `page` (PDF only) and, for a transcript,
`start_seconds` and `end_seconds` of the row the chunk came from.
A failure (for example, file not found) comes back as HTTP 500 with the reason in `detail.message`.

### `rw-retrieve`: best matching passages, no generation

| Node | Tweak fields |
|---|---|
| `ChatInput` | the query goes in `input_value` (top-level) |
| `Embeddings` | `model`, `base_url`, `document_prefix`, `query_prefix` (the workspace's pinned prefixes; empty for none) |
| `Search` | `collection_name`, `top_k`, `min_score`, `folder` |

Output `ChatOutput-passages`: `{ collection, query, passages }`, where `passages` is a list of
`{ rank, id, text, score, document_id, filename, folder, page, start_seconds, chunk_index }`, best first; `score` is cosine
similarity and hits below `min_score` are left out. An unknown collection returns an empty list.

The search is hybrid: the 200 best passages by meaning (Chroma's vector search) and the 200 best by words (BM25 over each
passage's text and file name) are fused with reciprocal rank fusion (k = 60), and the top `top_k` are kept. So "best first"
is the fused order, and `score` (cosine) need not fall steadily down the list. The keyword index lives in the Langflow worker,
one per collection, and is rebuilt when the collection's passage count changes or after two minutes.

### `rw-answer`: retrieve, prompt, generate (streams)

Same `Embeddings` and `Search` tweaks as `rw-retrieve`, plus:

| Node | Tweak fields |
|---|---|
| `Prompt` | `template` (uses `{context}` and `{question}`) |
| `LLM` | `provider` (`lmstudio`, `openai`, `anthropic`, `gemini`), `model_name`, `api_key`, `base_url`, `temperature`, `system_message`, `reasoning_effort` (empty: not sent; LM Studio and OpenAI only) |

Outputs `ChatOutput-answer` (the answer text; tokens stream with `?stream=true`) and
`ChatOutput-citations` (the passages given to the model, same shape as `rw-retrieve`).

### `rw-chat`: answer the latest message of a conversation (streams)

Stateless: the API keeps the history in its `messages` table and sends the last turns on each run.
Same `Embeddings`, `Search`, `Prompt` and `LLM` tweaks as `rw-answer`, plus:

| Node | Tweak fields |
|---|---|
| `ChatInput` | `input_value` (top-level) is **what to search for**: the latest message, plus the previous question so follow-ups find passages |
| `Prompt` | `question`: the latest message alone, for the prompt. `history`: earlier turns as `User: …` / `Assistant: …` lines |

The prompt template uses `{history}`, `{context}` and `{question}`. Outputs are the same as `rw-answer`.
The search hangs off the chat input on purpose: Langflow only returns outputs downstream of the chat
input, so a separate text input for the query loses `ChatOutput-citations`.

### `rw-delete`: delete a document's vectors

| Node | Tweak fields |
|---|---|
| `Delete` | `collection_name`, `document_id` |

Output `ChatOutput-result`: `{ document_id, deleted }`.
