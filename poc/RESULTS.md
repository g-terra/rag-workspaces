# POC results

Run on 2026-11-20 against **Langflow 1.13.3** and **ChromaDB 1.5.9**, with the
OpenAI-compatible stand-in in place of LM Studio. 30 of 30 checks pass on a fresh
stack (`docker compose down -v`, then `scripts/up.sh`, then `node client/run-poc.ts`).

## Verdict

All four assumptions hold, ingestion works end to end, and one answer flow can switch
between LM Studio, OpenAI, Anthropic and Gemini per request. **The plan can go ahead
with Langflow, with four changes** (details under Findings):

1. Langflow 1.13 removed its Chroma integration. We keep Chroma by shipping small custom components that call Chroma's REST API.
2. The built-in OpenAI Embeddings component can't talk to LM Studio. We ship a small LM Studio embeddings component.
3. Langflow needs two security settings for a model server on the host: an SSRF allowlist entry, and no `OPENAI_API_KEY` in its environment.
4. The API addresses flow nodes by fixed ids (`Search`, `Embeddings`, `LLM`…), so those ids become a contract between the API and the flow JSON.

So the repo gains about 300 lines of Python inside Langflow (`components/`). The API stays
TypeScript. Langflow components are Python by design, which is worth one line in the report's
decisions section.

| # | Assumption | Result | What it took | Fallback if it fails on LM Studio |
|---|---|---|---|---|
| 1 | Per-request tweaks let one flow serve many workspaces (collection, models, folder, chunking, prompt) | **PASS** (8/8) | Fixed node ids in the flow JSON; tweaks keyed by those ids | Generate one flow per workspace from a template when the workspace is created |
| 2 | A retrieve flow returns structured passages (text, score, document id, page) via the run API | **PASS** (3/3) | Custom search component; the API parses one JSON string | API queries Chroma directly for retrieval and keeps Langflow for generation only |
| 3 | Tokens stream through Langflow's run API | **PASS** (1/1) | The model node must be wired to a node whose id starts with `ChatOutput-` | API streams from LM Studio directly, with the prompt built by a Langflow flow |
| 4 | Startup automation: flows imported from repo JSON, API key created, auto-login off | **PASS** (5/5) | `LANGFLOW_LOAD_FLOWS_PATH` + a bootstrap that logs in, upserts flows and rotates a key | Create the key once by hand and pass it in `.env` (`LANGFLOW_API_KEY`) |
| 5 | Ingestion as a flow: PDF/DOCX/MD/TXT, split, embed, write with document-id metadata, delete by id | **PASS** (9/9) | Custom loader (page numbers from PDFs) and Chroma upsert/delete components | API-side ingestion worker (LangChain.js), the option the plan dropped |
| 6 | Model provider is a per-request setting (LM Studio default; OpenAI, Anthropic, Gemini) | **PASS** (4/4), partly proxied, see F7 | Custom Workspace Chat Model node; API sends provider, model and key as tweaks | One LLM node per provider behind a router node in the flow |

Streaming numbers from the run: 23 token events, the first after 136 ms, spread over 873 ms
(the stand-in waits 40 ms per token), and the concatenated tokens equal the final message.
The `end` event also carries the Citations output, so one streamed request gives the API
both the answer and its passages.

## Findings

### F1. Langflow 1.13 retired Chroma (biggest change)

From 1.13.0 (2026-10-22) the Chroma DB component is a stub that raises
`ChromaMigrationRequiredError`. The image doesn't ship `chromadb`, and the error text
says that installing it "does not enable this retired integration". Langflow now pushes
its own Knowledge Bases instead (SQLite, Postgres, OpenSearch, Astra, MongoDB backends).

Options considered:

- **Custom components over Chroma's REST API (chosen, tested).** `chroma_upsert.py`,
  `chroma_search.py` and `chroma_delete.py` use `httpx`, which is already in the image, so
  there's no custom Docker image. They also give us exactly what the plan needs: deleting by
  document id, idempotent re-ingest (delete then upsert, with ids `<doc>:<n>`), structured
  passages with cosine scores, and a folder filter.
- Pin Langflow 1.12.10, the last line with Chroma built in. Not tested. It would freeze us on
  an old line, and the built-in component never returned scores or deleted by id anyway.
- Switch to a Langflow Knowledge Base backend such as Postgres/pgvector. That reverses the
  ChromaDB decision and ties storage to Langflow's per-user KB model, which doesn't map
  cleanly onto workspaces.

### F2. Built-in OpenAI Embeddings can't talk to LM Studio

With `tiktoken_enable` on, LangChain sends token-id arrays, which LM Studio rejects (the
stand-in copies that behaviour). With it off, LangChain downloads a Hugging Face tokenizer
to check context length. That download fails offline, and in the cloud sandbox it hung for
47 s and then errored. The component doesn't expose `check_embedding_ctx_length`, so
`lmstudio_embeddings.py` sets it to false. The built-in **OpenAI chat** component works
with LM Studio as is, using its base URL field.

Also worth knowing: in the slim 1.13 image the LM Studio components moved to an
`lfx-bundles` package that isn't installed.

### F3. Two security settings Langflow 1.13 needs for a host model server

- `LANGFLOW_SSRF_ALLOWED_HOSTS=host.docker.internal`. Langflow blocks model base URLs on
  private networks by default, and the host is one.
- **Don't** put `OPENAI_API_KEY` in Langflow's environment. A credential-egress guard refuses
  to send any key that matches a server environment value to a non-OpenAI host. It compares
  values, so even a dummy `lm-studio` in the env trips it. The flows carry the dummy key
  instead. For the optional hosted provider, either allowlist its host in
  `LANGFLOW_PROVIDER_CREDENTIAL_ALLOWED_HOSTS` or have the API pass the key as a tweak.

### F4. Startup automation details

- `LANGFLOW_LOAD_FLOWS_PATH` imports `flows/*.json` on first boot with auto-login off, and
  **updates them in place on every restart** (matched by the fixed flow id). So the repo JSON
  stays the source of truth.
- `LANGFLOW_SECRET_KEY` must be a Fernet key (32 url-safe base64 bytes). A hex key starts
  fine, then breaks API key creation with "Fernet key must be 32 url-safe base64-encoded
  bytes". `scripts/up.sh` generates a valid one.
- Langflow shows an API key's value only once, at creation. So on every boot the bootstrap
  mints `rag-api-<timestamp>` and revokes older `rag-api-*` keys. The run confirmed the old
  key gets 403 and the new one 200. In the real API the key lives in memory or in the API's
  secret store.
- `/api/v1/login` is rate-limited (HTTP 429 with `retry_after: 60`) after a handful of logins
  in a row. The bootstrap logs in once per boot and honours `retry_after`.

### F5. Node ids are part of the contract

Tweaks are keyed by node id, so the flows use readable fixed ids: `Loader`, `Split`,
`Upsert`, `Embeddings`, `Search`, `Prompt`, `LLM`, `Delete`. Chat input and output nodes
**must** keep the `ChatInput-` / `ChatOutput-` prefix. Langflow decides a node's kind from
the text before the first `-`, and the LLM only streams when it's wired to a node it
recognises as a Chat Output. The first build used `Answer` as the id and silently fell back
to non-streaming.

### F6. Structured output is a JSON string inside a chat message

The run API has no "return this Data object" mode. `output_type=debug` returns empty
results for non-output nodes. So the passages arrive as the ChatOutput's text, wrapped in a
```` ```json ```` fence, and the API strips the fence and parses it. That's one function in
the planned `langflow-client` package, and the flow tests should cover it.

### F7. Provider switch (LM Studio, OpenAI, Anthropic, Gemini) per request

Langflow's own "Language Model" node can override the provider, but it can't reach LM Studio:
it has no OpenAI-compatible base URL, and the LM Studio bundle isn't installed. So
`chat_model.py` ("Workspace Chat Model") builds `ChatOpenAI` for `lmstudio` and `openai`,
`ChatAnthropic` for `anthropic`, and `ChatGoogleGenerativeAI` for `gemini`. All three
LangChain packages already ship in the image. The API sends `provider`, `model_name` and
`api_key` (plus an optional `base_url`) as tweaks on the `LLM` node. That means
**provider keys live in the API's settings, not in Langflow's environment**, which also
sidesteps F3's credential guard.

What the run proves. The sandbox can't reach the cloud providers, so:

- **OpenAI and Anthropic** were pointed at the stand-in, which speaks both the Chat
  Completions and Anthropic Messages APIs. Both streamed through Langflow (17 tokens each),
  and the stand-in log shows the right API and model.
- **Gemini** was checked by routing only. The request went to
  `generativelanguage.googleapis.com` and failed on the sandbox network.
- **Switching back** to `lmstudio` on the same flow worked.

Set `POC_OPENAI_API_KEY`, `POC_ANTHROPIC_API_KEY` or `POC_GEMINI_API_KEY` and rerun to make
real calls. Embeddings stay on LM Studio. A cloud embedding provider would be a similar small
switch in `lmstudio_embeddings.py`, but it wasn't asked for.

### F8. Smaller things for the API

- Always send a `session_id` (the conversation id, or a fresh id per request). Without one,
  every run shares the flow id as its session, and the stored Answer messages pile up under it.
- A failed ingestion comes back as HTTP 500 with the component's error in `detail.message`
  (for example "File not found: /data/uploads/ouc/missing.pdf"). That's enough for the
  `failed` status and retries.
- Page numbers come from PDFs only. DOCX, MD and TXT passages have `page: null`.
- Ingest timing with the stand-in: 0.2 to 1 s per small file. Real embedding time will
  dominate with LM Studio.

## Not covered

- Answer quality, and LM Studio itself. Rerun with the steps in [README.md](README.md#rerun-against-lm-studio) on your machine.
- The chat flow with conversation memory (`chat.json`), Whisper/video ingestion, large PDFs
  and throughput.
- Langflow's newer v2 workflow API. Everything here uses `/api/v1/run`.

## Changes this implies for the plan (PR #1)

- Architecture: add `langflow/components/` (custom Python components) next to `flows/`, and
  pin `langflowai/langflow:1.13.3` and `chromadb/chroma:1.5.9`.
- Env: add `LANGFLOW_SSRF_ALLOWED_HOSTS`, `LANGFLOW_COMPONENTS_PATH` and `LANGFLOW_LOAD_FLOWS_PATH`, and note the Fernet secret format.
  Remove any `OPENAI_API_KEY` from the Langflow service.
- Open question "Langflow key: auto-create vs .env" is settled: auto-create on boot with
  rotation, with `.env` as the fallback.
- Decisions: record F1, and that the Python components live inside Langflow while the API stays TypeScript.
- Model provider setting: stored per workspace in the API, with keys in the API's secret store, and sent as `LLM` tweaks on each run (F7).
- `langflow-client`: a node-id map, the JSON-fence parser, and session ids on every call.

## Raw run (stand-in, fresh stack)

| Check | Result | Detail |
|---|---|---|
| auto-login is off (GET /api/v1/auto_login refused) | PASS | `HTTP 403` |
| run API refuses calls without an API key | PASS | `HTTP 403` |
| flows from flows/*.json were already imported at startup | PASS | all 4 present before bootstrap |
| bootstrap is idempotent: flows updated in place, keys rotated | PASS | 4 updated, 1 key revoked |
| new key works, rotated-out key is rejected | PASS | new 200, old 403 |
| ingest PDF into ws_poc_ouc | PASS | 3 chunks, 3 pages, 3 in Chroma |
| ingest DOCX into ws_poc_ouc | PASS | 1 chunk, 1 in Chroma |
| ingest MD into ws_poc_ouc | PASS | 1 chunk, 1 in Chroma |
| ingest TXT into ws_poc_personal | PASS | 1 chunk, 1 in Chroma |
| PDF chunks carry document_id, filename, folder and page metadata | PASS | pages 1, 2, 3 |
| re-ingesting a document replaces its vectors | PASS | 3 before, 3 after |
| delete by document id through the rag-delete flow | PASS | deleted 1, 5 → 4 |
| delete by document id directly against Chroma | PASS | 0 left |
| a failed ingestion surfaces as an HTTP error | PASS | HTTP 500, "File not found" |
| collection_name tweak isolates workspaces | PASS | recipe only found in ws_poc_personal |
| folder tweak filters inside a workspace | PASS | only COS512 passages |
| chunking tweak changes how a document is split | PASS | 9 chunks at size 80 vs 3 by default |
| embedding model tweak reaches the model server | PASS | both embed models seen |
| chat model tweak reaches the model server | PASS | standin-chat-b answered |
| unknown model name fails loudly | PASS (skipped) | only meaningful on LM Studio |
| prompt template tweak replaces the prompt | PASS | marker at start of prompt |
| 12 concurrent runs with different tweaks don't bleed | PASS | 0 of 12 mismatched |
| retrieve returns text, score, document_id, page, filename | PASS | top hit doc-pdf page 2 |
| non-paged files have page null | PASS | DOCX page null |
| unknown workspace returns zero passages | PASS | empty list |
| answer flow streams tokens through the run API | PASS | 23 tokens, first at 136 ms |
| provider=openai via tweak, streamed | PASS | Chat Completions call, 17 tokens (stand-in) |
| provider=anthropic via tweak, streamed | PASS | Messages API call, 17 tokens (stand-in) |
| provider=gemini via tweak | PASS | request went to generativelanguage.googleapis.com |
| back to provider=lmstudio on the same flow | PASS | 17 tokens |
