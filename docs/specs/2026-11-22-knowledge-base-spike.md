---
title: spike Langflow's native knowledge bases as a Chroma replacement
date: 2026-11-22
pr: "#31"
status: merged
areas: [flows, infra]
---

# Spike Langflow's native knowledge bases as a Chroma replacement

## Summary

Adds `spike/knowledge-bases/`, a throwaway experiment that checks whether Langflow 1.13.3's
built-in Knowledge component and knowledge-base storage can replace our Chroma components. It
runs against its own Docker stack and changes nothing in the app. The verdict
(`spike/knowledge-bases/RESULTS.md`) is go, on the SQLite backend, with one small delete
component; the follow-up PRs are proposed there, not built.

## Why

Langflow 1.13 dropped its Chroma integration, so decision 20 in `docs/decisions.md` keeps
Chroma through about 260 lines of custom components (`poc/RESULTS.md` F1). Langflow now ships a
native Knowledge component (Ingest and Retrieve modes) with its own storage. The owner asked for
evidence on whether our API could use it: one knowledge base per workspace created
programmatically, chosen per request, per-document delete, and whether scores, folder filters,
page numbers and dedup survive.

## Design

1. `spike/knowledge-bases/docker-compose.yml` starts Postgres with pgvector and Langflow 1.13.3
   (`Dockerfile` adds the `pgvector` package). It mounts the POC's `document_loader.py` and this
   spike's `components/kb_spike/knowledge_delete.py`; the Chroma components are not mounted.
2. `run-spike.ts` logs in, sets the OpenAI Compatible provider variables, creates knowledge bases
   through `POST /api/v1/knowledge_bases/`, builds three flows from the running Langflow's
   component templates (as `poc/client/build-flows.ts` does), runs every check and writes
   `results/`. `SPIKE_BACKEND=sqlite` repeats the run on the SQLite backend.
3. Flows: `kb-spike-ingest` (Loader → Split → Knowledge in Ingest mode), `kb-spike-retrieve`
   (Chat Input → Knowledge in Retrieve mode → Type Convert → Chat Output), `kb-spike-delete`
   (KnowledgeDocumentDelete → Chat Output).

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Spike in its own folder and compose project | Change `docker-compose.yml` and the flows directly | The owner asked not to change the main code or reverse decision 20 before seeing evidence |
| Test both Postgres and SQLite backends | Postgres only (the coordinator's starting point) | SQLite turned out to work on the stock image and to filter exactly, which changes the recommendation |
| Keep the POC document loader in the ingest flow | Langflow's upload route or File component | Only our loader keeps PDF page numbers (RESULTS F6) |
| Prototype a delete component | Delete rows from the vector store directly from the API | The API calls only Langflow (decision 18); the component reuses Langflow's own `delete_by` |
| TypeScript runner reusing `poc/client/lib.ts` | A Python script | Same tooling and helpers as the POC, no new dependency |

## Interfaces and contracts

- **HTTP API**: None (the app's API is unchanged).
- **Configuration**: Only inside the spike's `.env` (`LANGFLOW_SUPERUSER`, `LANGFLOW_SUPERUSER_PASSWORD`,
  `LANGFLOW_SECRET_KEY`) and the runner's `SPIKE_EMBED_MODEL`, `SPIKE_MODEL_BASE`,
  `SPIKE_MODEL_SERVER_LOG`, `SPIKE_BACKEND`.
- **Data**: The spike stack's own containers; no volumes are kept.
- **Langflow**: None for the app. The spike's flows use node ids `Loader`, `Split`, `Knowledge`,
  `Delete`, `ChatOutput-passages`, `ChatOutput-result`.
- **Events and logs**: None.

## Operations

None for an existing install. The spike stack uses port 7860, like the app's Langflow, so stop
one before starting the other. `docker compose down -v` in the spike folder removes everything.

## Testing

`run-spike.ts` is the test: 20 checks per backend against the running stack, recorded in
`spike/knowledge-bases/RESULTS.md`. Postgres: 16 of 20 pass; SQLite: 17 of 20. The failures are
the expected gaps (no native per-document delete; no page numbers through Langflow's upload route;
Postgres's post-search filter). To check by hand, follow `spike/knowledge-bases/README.md`.

## Out of scope and follow-ups

Not covered: real LM Studio, hosted embedding providers, scale and concurrent ingestion (listed
in RESULTS.md). The four follow-up PRs that would replace Chroma are proposed at the end of
`spike/knowledge-bases/RESULTS.md`, to start after the current review stack merges and only if
the owner supersedes decision 20.

## Docs updated

None needed: the app's behaviour is unchanged. `docs/decisions.md` changes only if the owner
accepts the follow-ups.
