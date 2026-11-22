---
title: Ingestion queue on pg-boss running the Langflow ingest flow
date: 2026-11-20
pr: '#16'
status: in review
areas: [api, langflow-client, flows]
---

# Ingestion queue on pg-boss running the Langflow ingest flow

## Summary

Uploaded documents are now ingested: a pg-boss queue in Postgres runs the `rw-ingest` flow for one
document at a time, moving it `queued` → `processing` → `ready` (with a passage count) or `failed` (with
Langflow's reason). Failed runs are retried with backoff, vectors are cleaned before and after a failed
attempt, and a reindex route re-runs a document.

## Why

Decision 3 (ingestion runs as a Langflow flow; the API keeps the bookkeeping) and decision 15 (queue on
Postgres with pg-boss, no Redis). Completes the upload path started in #15.

## Design

1. `apps/api/src/services/ingest.ts`, `IngestProcessor.process()`:
   1. mark `processing`, count the attempt;
   2. delete the document's vectors;
   3. run `rw-ingest` with tweaks (see Interfaces), with a timeout of `INGEST_TIMEOUT_MS` plus
      `INGEST_TIMEOUT_MS_PER_MB` per MB;
   4. parse `ChatOutput-result` JSON and mark `ready` with `passageCount`.

   On failure: store Langflow's reason, delete any vectors written, go back to `queued`; on the last
   attempt mark `failed`. If the row disappeared mid-run, delete what was written.
2. Same file, `PgBossIngestQueue`: one job at a time install-wide, backoff from 15 s doubling, one
   waiting and one running job per document (singleton key). On start: put `processing` documents back
   to `queued`, enqueue every `queued` document, then start the worker, and only once the API holds a
   Langflow key.
3. `apps/api/src/services/providers.ts`: embedding endpoint per provider (LM Studio default; OpenAI or
   Gemini via their OpenAI-compatible APIs when the key is set). Keys reach Langflow only as per-run
   tweaks (POC F7).
4. `packages/langflow-client`: `run()` and the output helpers `outputsByComponent`, `messageText`,
   `parseJsonMessage`.
5. `apps/api/src/main.ts`: queue starts before listening (uploads can enqueue); worker after the key.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| The document row is the source of truth; pg-boss only says "work on this" | Trust pg-boss state | Lost queue state is harmless: start-up re-enqueues every `queued` document |
| Delete vectors before the run and after a failure | Only before | No duplicates on retry, and a failed document is never searchable |
| One file at a time | Parallel workers | One local model server; change `localConcurrency` for hosted providers |
| Timeout scaled by file size | Fixed timeout | Large PDFs need longer; small files fail fast |
| Worker waits for the Langflow key | Start immediately | A slow Langflow doesn't burn retries |

## Interfaces and contracts

- **HTTP API**: `POST /v1/workspaces/{slug}/documents/{id}/reindex` (editor) → 202, resets attempts;
  409 while the document is processing. `DELETE` of a processing document → 409.
- **Configuration**: `INGEST_MAX_ATTEMPTS` (4; also pg-boss `retryLimit`), `INGEST_TIMEOUT_MS` (2 min),
  `INGEST_TIMEOUT_MS_PER_MB` (1 min), `LMSTUDIO_BASE_URL`, optional `OPENAI_API_KEY`, `GEMINI_API_KEY`.
- **Data**: pg-boss creates and versions its own `pgboss` schema in the app database (not in Drizzle
  migrations). Document columns used: `status`, `attempts`, `error`, `passage_count`.
- **Langflow**: `rw-ingest` tweaks: `Loader` (`file_path`, `document_id`, `filename`), `Split`
  (`chunk_size`, `chunk_overlap`), `Embeddings` (`model`, `base_url`, `api_key`), `Upsert`
  (`collection_name`, `document_id`); session id `ingest-<document id>-<attempt>`; output
  `ChatOutput-result` with JSON `{ chunks }`.
- **Events and logs**: `document ready` with chunk count and attempt; failures with Langflow's reason.

## Operations

- `INGEST_MAX_ATTEMPTS` drives both the row and pg-boss; if they drift, a document can wait in `queued`
  until the next API start.
- A long document blocks the queue for its duration.
- A workspace on a provider without a key fails with "OPENAI_API_KEY is not set" (or similar).

## Testing

`apps/api/src/services/ingest.test.ts`: success, clean-before-run order, retry then fail, cleanup after
failure, delete during a run, timeout, missing key, deleted while queued, recovery, and a real pg-boss
round trip. Route tests: reindex roles, 409s, cross-workspace 404. End to end on the stack with the POC
stand-in model server: queued PDF and MD recovered on start, a DOCX ready in about 2 s, PDF chunks carry
page numbers.

## Out of scope and follow-ups

Status stream (#17), embedding settings lock and workspace reindex, friendlier message for scanned PDFs,
Anthropic key (chat only, with answers).

## Docs updated

`.env.example`, `docker-compose.yml`. The architecture's "Rules that keep ingestion honest" already
described the behaviour.
