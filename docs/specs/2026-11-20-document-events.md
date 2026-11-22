---
title: Live document status stream over server-sent events
date: 2026-11-20
pr: '#17'
status: in review
areas: [api]
---

# Live document status stream over server-sent events

## Summary

`GET /v1/workspaces/{slug}/documents/events` streams document changes in one workspace as server-sent
events: a `snapshot` of unfinished documents on connect, then a `document` event for each upload or
status change and a `removed` event for each delete. The admin UI uses it for live upload status.

## Why

Architecture "Ingestion": "SSE events with a snapshot on connect". Decision 15: live status needs no
pub/sub with one API process.

## Design

1. `apps/api/src/services/document-events.ts`, `DocumentEvents`: an in-process emitter keyed by
   workspace.
2. Emitters: the ingest processor on every status change and recovery; the upload, reindex and delete
   routes.
3. `apps/api/src/routes/documents.ts`, `events` route: subscribe first, then send the snapshot
   (`queued`, `transcribing`, `processing` documents), then forward events for that workspace; a
   `: keep-alive` comment every 15 s (`HEARTBEAT_MS`); `X-Accel-Buffering: no` for nginx. If the snapshot
   query fails, end the stream. Open streams end on server shutdown.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Subscribe before the snapshot | Snapshot first | A change can arrive twice but never be missed; events mean "latest state of X" |
| In-process emitter | Postgres LISTEN/NOTIFY, Redis | One API process by design |
| Clients read with `fetch` | `EventSource` | `EventSource` can't send `Authorization` |

## Interfaces and contracts

- **HTTP API**: `GET /v1/workspaces/{slug}/documents/events` (reader), `text/event-stream`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: events `snapshot` (`{ items: Document[] }`), `document` (a full `Document`),
  `removed` (`{ id }`); keep-alive comments every 15 s.

## Operations

With two API processes, a client on one wouldn't see the other's changes; run one. `docker compose stop`
doesn't hang on open streams.

## Testing

SSE tests at the end of `apps/api/src/routes/documents.test.ts`: a real HTTP connection checks the
snapshot, the workspace filter and change events; anonymous 401, stranger 404; upload, reindex and
delete each emit. Live: `curl -N` showed `snapshot`, then `processing`, then `ready`.

## Out of scope and follow-ups

Answer streaming uses the same SSE patterns (#20).

## Docs updated

None needed: the architecture already described the stream.
