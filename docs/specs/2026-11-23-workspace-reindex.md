---
title: reindex a workspace, optionally with a new embedding model
date: 2026-11-23
pr: pending
status: in review
areas: [api, docs]
---

# Reindex a workspace, optionally with a new embedding model

## Summary

`POST /v1/workspaces/{slug}/reindex` (admin) empties the workspace's Chroma collection and runs the ingest
flow again for every document. With `embeddingProvider` and `embeddingModel` in the body it also switches
the workspace to that model, which is the only way to change it. While it runs the workspace is
`reindexing`: search, answers and chat answer `503` with `Retry-After: 30`, and the workspace goes back to
`active` by itself when the last document is `ready` or `failed`.

## Why

The admin UI's workspace settings need a "Reindex" button and a way to change the embedding model
(docs/work-breakdown.md M1 item 5, M4 item 3). `PATCH` refuses to change the embedding model because
vectors from two models can't be compared and may differ in size (docs/architecture.md, "Changing the
embedding model"). The `reindexing` workspace status existed in the schema since the workspaces PR but
nothing set it.

## Design

1. **Route** (`apps/api/src/routes/workspaces.ts`): admin only (`requireWorkspace(..., 'admin')`; a
   member who isn't admin gets `403`, a stranger `404` as elsewhere). The body is `ReindexWorkspace`
   (`packages/shared/src/workspaces.ts`) or nothing at all.
2. **`startReindex`** (`apps/api/src/services/reindex.ts`):
   - Merges the new provider and model into the settings and checks the provider can be used
     (`embeddingEndpoint`); a hosted provider without its key is `422`. Nothing has changed yet.
   - Drops and recreates the Chroma collection `ws_<slug>`. If Chroma is down this throws and the
     database is untouched.
   - In one transaction: locks the workspace row (`FOR UPDATE`, so two reindex requests can't both
     start), refuses with `409` if it is already `reindexing`, sets `reindexing` plus the settings, and
     sets every document to `queued` with `attempts 0`, `error null`, `passageCount null`.
   - Emits a document event for each (the SSE library updates live) and enqueues each on pg-boss.
   - A workspace with no documents finishes at once.
3. **Ingestion** (`apps/api/src/services/ingest.ts`):
   - A run writes its result only on the row it claimed: `status = 'processing'` and the same
     `attempts`. A reindex that requeued the document mid-run makes the stale run return `gone`; it
     removes the vectors it wrote and leaves the row `queued` for the new job. The queue runs one
     document at a time, so the new job starts after the stale run gives up.
   - After every outcome except `retry`, `finishReindexIfDone` runs. It is one `UPDATE ... WHERE status =
     'reindexing' AND NOT EXISTS (pending document)`, so two documents finishing together can't both miss
     it. Pending means `queued`, `processing` or `transcribing`.
   - `recover()` on startup also runs it for every reindexing workspace, in case the API stopped just
     after the last document finished.
4. **Deleting a document** (`apps/api/src/routes/documents.ts`) runs the same check, since deleting the
   last pending document also ends the reindex.
5. **Guards**: `assertSearchable` answers `503` for the three passage routes, `POST .../answers` and
   `POST .../conversations/{id}/messages`. Listing and reading documents, conversations and answers keeps
   working, so the admin UI can show progress.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Drop the collection and rebuild into it | Build a second collection and swap when done (search keeps working on the old one) | Simpler, and the API already names collections by slug. A reindex of this project's material takes minutes. The blue-green swap can come later if a workspace gets big |
| Block search with `503` while reindexing | Answer from the documents done so far | Half the material gives confidently wrong answers with no hint that anything is missing |
| A reindex resets `attempts` to 0 | Keep counting | Each document gets its full retry budget with the new model |
| The claim is status plus `attempts` | A claim token column | No migration. With one worker the stale run always ends before the new job starts, so the same attempt number can't belong to two live runs |
| Finish detected by the ingest worker after each document | A timer polling reindexing workspaces | No new moving part; `recover()` covers a crash in between |
| No body means "same model" | Require `{}` | The admin UI's button can POST with no body; Fastify hands an absent body to the schema as `null`, so the schema is `ReindexWorkspace.nullish()` |
| Admin only | Editors too | It empties search for everyone in the workspace, and a model change can send material to a hosted provider |

## Interfaces and contracts

- **HTTP API**: `POST /v1/workspaces/{slug}/reindex`, body optional
  `{ "embeddingProvider": "lmstudio" | "openai" | "gemini", "embeddingModel": "..." }` (strict; a provider
  needs a model, else `400`). `202` with the workspace (`status: "reindexing"`, or `"active"` when it has
  no documents). `409` already reindexing, `422` provider key missing, `403` not admin, `5xx` Chroma
  unreachable. While reindexing, `GET .../passages`, `GET .../passages/{id}`,
  `GET .../documents/{id}/passages`, `POST .../answers` and `POST .../conversations/{id}/messages`
  answer `503` with `Retry-After: 30`.
- **Configuration**: None.
- **Data**: no migration. Uses the existing `workspace_status` value `reindexing`. Document rows are
  reset as described above.
- **Langflow**: None. The ingest flow runs as for an upload.
- **Events and logs**: one `document` SSE event per requeued document. Log lines
  `workspace reindex started` (with `workspace`, `by`, `embeddingModel`) and
  `workspace reindex finished` (`workspace`).

## Operations

Nothing to do on upgrade. A reindex can't be undone: the old vectors are gone the moment it starts, and
switching back to the old model is another reindex. If the API stops mid-reindex, startup recovery
requeues the documents left `processing` and closes the reindex when everything is done. A workspace
stuck `reindexing` with no pending documents is fixed by restarting the API.

## Testing

- `apps/api/src/routes/reindex.test.ts`: collection dropped and recreated, every document queued and
  enqueued, `503` with `Retry-After` on all five guarded routes while the document list still works;
  `409` on a second reindex; an empty workspace is `active` at once; the model change is saved;
  `422` for OpenAI without a key and `400` for a provider without a model, both changing nothing;
  Chroma down changes nothing; an editor gets `403`; deleting the last pending document ends it.
- `apps/api/src/services/ingest.test.ts` ("during a workspace reindex"): a run requeued mid-way leaves
  the row `queued` and removes its vectors (ready and failure paths); the workspace stays `reindexing`
  until the last document is `ready` or `failed` (a `retry` keeps it open); `recover()` closes a
  finished one. The two claim tests fail without the claim condition.

By hand, on a running stack with a workspace that has documents:

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/workspaces/ouc/reindex
curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/v1/workspaces/ouc/passages?query=test' -i | head -5
```

The second answers `503` until `GET /v1/workspaces/ouc` shows `"status": "active"` again.

## Out of scope and follow-ups

- Listing the available models for the settings screen is `GET /v1/system` (next PR).
- Changing chunking still goes through `PATCH` plus a reindex with no body; doing both in one call is not
  needed yet.
- Blue-green collections (search stays up during a reindex).

## Docs updated

- `docs/api-schema.md`: the reindex route, `status`, the `PATCH` note, and the `409` and `503` rows.
- `docs/architecture.md`: status table.
