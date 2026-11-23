# Knowledge base spike: results

Run on 2026-11-22 against **Langflow 1.13.3**, with the OpenAI-compatible stand-in
(`poc/standin/server.ts`) in place of LM Studio. Each question was run twice, once per
storage backend: **Postgres + pgvector** (Langflow image plus the `pgvector` package, see F1)
and **SQLite** (the stock `langflowai/langflow:1.13.3` image). Reproduce with `./up.sh`, then
`node run-spike.ts` and `SPIKE_BACKEND=sqlite node run-spike.ts`.

## Verdict: go, on the SQLite backend, with one small custom component

Langflow's native Knowledge component can replace our three Chroma components
(`chroma_upsert.py`, `chroma_search.py`, `chroma_delete.py`) and the LM Studio embeddings
component, so the stack loses the Chroma container and about 220 lines of Python (260 removed, 40 added). Everything
the API needs works through Langflow's REST API and per-request tweaks, except deleting one
document, which needs a 40-line component (F4). Keep our page-aware document loader: Langflow's
own upload route drops page numbers (F6).

Use the **SQLite** backend, not Postgres: it runs on the stock image, and its folder filter is
exact. On Postgres the folder filter is applied after the search and can return nothing (F5).

This doesn't change anything yet. Decision 20 (Chroma through custom components) stands until
you decide; the follow-up PRs are proposed at the end.

| # | Question | Postgres | SQLite | Notes |
|---|---|---|---|---|
| 1 | Our API creates one knowledge base per workspace over REST | **PASS** (4/4) | **PASS** (4/4) | `POST /api/v1/knowledge_bases/` with the API key; 409 on a duplicate name; `DELETE /api/v1/knowledge_bases/{name}` for workspace delete. The route is internal (F2) |
| 2 | One flow serves every workspace: the knowledge base is picked per request with a tweak | **PASS** (3/3) | **PASS** (3/3) | Tweak `Knowledge.knowledge_base`. An unknown name fails with a misleading error (F7) |
| 3 | Delete one document's chunks | **FAIL** natively, **PASS** with a component (2/4) | same (2/4) | No route and no component mode for it. `components/kb_spike/knowledge_delete.py` calls the backend's own `delete_by` and removes exactly one document (F4) |
| 4a | Similarity scores | **PASS** | **PASS** | `_score` is −(cosine distance), best first; the API shows `1 + _score`. SQLite needs `metric: cosine` at creation (F3) |
| 4b | Folder (metadata) filter | **FAIL** (1 of 2) | **PASS** (2/2) | Postgres filters only the best 4×`top_k` hits (F5) |
| 4c | Page numbers and document id for citations | **PASS** | **PASS** | Through our loader in the ingest flow; not through Langflow's upload route (F6) |
| 4d | Dedup on re-ingest | **PASS** (2/2) | **PASS** (2/2) | Re-ingesting a document adds nothing; the same file under another document id is kept, because `document_id` is part of the dedup key |
| 5 | LM Studio embeddings without our custom component | **PASS** | **PASS** | Built-in "OpenAI Compatible" provider; the stand-in, which rejects token arrays like LM Studio, saw only valid requests |
| 6 | Per-user ownership | **PASS** | **PASS** | Another Langflow user can't list or read the knowledge bases (404). Our API's one Langflow user owns them all (F8) |

Run summaries: `results/summary-postgres.md`, `results/summary-sqlite.md` (written by the run,
not committed).

## Findings

Source references are to the installed packages `lfx==1.13.3` and `langflow-base==1.13.3`
(`pip download --no-deps lfx==1.13.3`).

### F1. The stock image can't use the Postgres backend

Creating a knowledge base fails with `PostgresBackend requires the 'pgvector' package`
(`lfx/base/knowledge_bases/backends/postgres.py:367`). The image has `psycopg` but not
`pgvector`, so Postgres needs our own image (`Dockerfile`, one `pip install`). Postgres also
needs the `pgvector/pgvector` server image instead of `postgres:16-alpine`, and a
`CREATE EXTENSION vector` that Langflow doesn't run. SQLite needs none of this.

### F2. The knowledge-base REST API is real but undocumented

Every route works with an API key (`x-api-key`), but the router is registered with
`include_in_schema=False` (`langflow/api/v1/knowledge_bases.py:98`), so it isn't in Langflow's
OpenAPI docs and could change in a minor release. We pin 1.13.3, so the risk is at upgrade
time: re-run this spike before moving Langflow.

The request we use:

```json
POST /api/v1/knowledge_bases/
{ "name": "ws_ouc", "embedding_provider": "OpenAI Compatible", "embedding_model": "<model>",
  "backend_type": "sqlite", "backend_config": { "metric": "cosine" } }
```

The embedding model is stored on the knowledge base and can't be switched per request. Changing
a workspace's embedding model means a new knowledge base and a reindex, as with Chroma today.

### F3. Scores

Retrieve rows carry `_score = -distance` (`lfx/base/knowledge_bases/backends/base.py:397`), best
first. Postgres always uses cosine distance. SQLite defaults to L2
(`backends/sqlite.py:340`), so knowledge bases are created with `backend_config.metric =
"cosine"`; then both backends return the same numbers for the same data (−0.635, −0.913, −1 in
the runs). The API turns this into a 0–1 similarity with `1 + _score`.

### F4. No per-document delete

`DELETE` on `/knowledge_bases/{name}/chunks?document_id=…` and `/documents/{id}` returns 405,
and the Knowledge component's modes are only Ingest and Retrieve
(`components/files_and_knowledge/knowledge.py:343`). Every backend implements `delete_by(where)`
(`backends/postgres.py:740`, `backends/sqlite.py:857`), which Langflow uses to roll back a failed
ingestion. `components/kb_spike/knowledge_delete.py` calls it for the flow owner's knowledge
base, matching the `document_id` chunk metadata. In the run it deleted all of one document's
chunks and left the other documents and the other workspace untouched.

### F5. On Postgres, the metadata filter runs after the search

With a filter, retrieval fetches `top_k × 4` nearest chunks and filters them in Python
(`knowledge.py:1819-1820`). A folder whose chunks all rank below that window returns nothing:
the run's `top_k = 1` search for folder `tips` returned 0 rows on Postgres and the right row on
SQLite, where the filter is part of the query. Folder-scoped search is a product feature for us,
so this is why SQLite is recommended.

### F6. Page numbers need our loader

Langflow's upload route (`POST /knowledge_bases/{name}/ingest`, what its UI uses) merges a PDF's
pages and keeps no page number. Our ingest flow keeps the POC's `WorkspaceDocumentLoader`, then
the built-in Split Text, then the Knowledge component in Ingest mode. Loader columns (`page`,
`document_id`, `filename`) become chunk metadata, and per-request metadata goes in the
`Knowledge.metadata_json` tweak (it lands in `source_metadata`, which the filter reads). The
ingest flow's column configuration marks `text` and `document_id` as identifier columns: the
dedup hash is built from them (`knowledge.py:1161`).

### F7. An unknown knowledge base gives a misleading error

Naming a knowledge base that doesn't exist fails the run with HTTP 500 "The requested model
provider is not available". The API should check the workspace's knowledge base exists (it
creates them) rather than surface that message.

### F8. Ownership: one Langflow user owns every workspace's knowledge base

Knowledge bases belong to the Langflow user whose API key runs the flow, and the component
resolves names within that user. Our API already uses one Langflow user (it creates its own key
at startup), so all workspaces' knowledge bases sit under it, and workspace access control
stays in our API, unchanged. The embedding provider's base URL is a variable of that user
(`OPENAI_COMPATIBLE_BASE_URL`, set by the API's bootstrap); a hosted provider's key can still be
sent per request in the `Knowledge.api_key` tweak, so provider keys stay out of Langflow's
environment (POC F3).

### Not covered

- Real LM Studio and hosted embedding providers (OpenAI, Gemini): only the stand-in was used.
- Large workspaces: SQLite search is an exact scan in batches of 256 vectors; fine for course
  material, not measured at scale.
- Concurrent ingestion into one SQLite knowledge base (it uses WAL; not load-tested).
- Moving existing Chroma data: the follow-up reindexes from the uploads volume instead.

## Proposed follow-up PRs (not built)

Each one after the current review stack (#10 to #30) merges, and only if you choose to replace
decision 20.

1. **`feat(langflow-client): knowledge base per workspace`**: create and delete the workspace's
   knowledge base through `/api/v1/knowledge_bases/` when a workspace is created or deleted; the
   bootstrap sets the OpenAI Compatible variables. Supersedes decision 20 in `docs/decisions.md`.
2. **`feat(flows): ingest and delete on native knowledge bases`**: `flows/ingest.json` becomes
   Loader → Split Text → Knowledge (Ingest); `flows/delete.json` uses the delete component; remove
   `chroma_upsert.py` and `chroma_delete.py`.
3. **`feat(flows): retrieve and answer on native knowledge bases`**: Knowledge (Retrieve) in
   `flows/retrieve.json` and `flows/answer.json`; the API maps `1 + _score` and the passage shape;
   remove `chroma_search.py` and `lmstudio_embeddings.py`.
4. **`build(compose): drop Chroma`**: remove the `chroma` service, `CHROMA_URL` and its readiness
   check; update `docs/architecture.md` and the README, with an upgrade note to reindex.
