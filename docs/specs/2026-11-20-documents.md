---
title: Document upload with type check, size limit and dedupe; list, download, delete
date: 2026-11-20
pr: '#15'
status: in review
areas: [api, db, infra]
---

# Document upload with type check, size limit and dedupe; list, download, delete

## Summary

Editors upload PDF, DOCX, Markdown and text files into a workspace. Each file is streamed to disk,
hashed and size-checked as it arrives, typed by its content, deduplicated by SHA-256 within the
workspace and stored as a `documents` row in status `queued`. Readers list, view and download documents;
editors delete them (vectors, row, then file).

## Why

Architecture "Ingestion" and decision 3: the API does the bookkeeping (uploads, dedupe, statuses) and
Langflow does the AI work. This is part 1; the ingest queue (#16) moves documents from `queued` to
`ready`.

## Design

1. `apps/api/src/services/storage.ts`: stage to `/data/uploads/<slug>/.incoming/`, hash and count bytes
   while streaming, `detectType()` (PDF by `%PDF-` header; DOCX as a zip named `.docx`; TXT/MD only if
   valid UTF-8 without NUL), path-escape guard, move to `<slug>/<document id>.<ext>`.
2. `apps/api/src/routes/documents.ts`, upload: all files in a request are accepted or none; empty → 400,
   too big → 413, unknown type → 415; existing hash → the existing document with `duplicate: true`; new →
   row `queued` and a hand-off to the ingest queue (no-op here). If the insert fails, the stored file is
   removed.
3. Delete order: Chroma vectors by `document_id`, the row, then the file. Deleting a workspace removes
   its uploads folder.
4. Migration `0003_documents.sql`: `documents` with type, size, `sha256`, `storage_path`, status enum
   (`queued`, `transcribing`, `processing`, `ready`, `failed`), attempts, error, passage count, tags;
   unique `(workspace_id, sha256)`; cascade on workspace delete.
5. `docker/api.Dockerfile` creates `/data/uploads` owned by `node`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Dedupe by hash per workspace | Global dedupe | Isolation: the same file in two workspaces is two documents |
| Type from content plus name | Trust the extension or MIME | A renamed binary never reaches the text loader |
| Stream to disk while hashing | Buffer in memory | Large files never sit in memory |
| All or nothing per request | Accept the good files | One clear answer; no half-done batch |
| Chroma first on delete | Row first | If Chroma is down nothing is deleted and the call can be retried |

## Interfaces and contracts

- **HTTP API**:
  - `POST /v1/workspaces/{slug}/documents` (editor, multipart `files`);
  - `GET .../documents` (reader; filters `status`, `type`);
  - `GET .../documents/{id}`, `GET .../documents/{id}/file`;
  - `DELETE .../documents/{id}` (editor).
- **Configuration**: `MAX_UPLOAD_BYTES` (200 MB), `UPLOADS_DIR` (`/data/uploads`).
- **Data**: table `documents`; files at `/data/uploads/<slug>/<document id>.<ext>`, readable by Langflow
  at the same path.
- **Langflow**: None yet (the path is what the ingest flow's `Loader` will receive).
- **Events and logs**: None.

## Operations

- Existing installs from before this change: the `uploads` volume is owned by root. Fix once with
  `docker compose run --rm -u 0 api chown node:node /data/uploads`.
- Hard to undo: the on-disk layout `<slug>/<doc id>.<ext>`.
- A crash between delete steps can leave an orphan file (to be listed by `pnpm doctor`, M6).

## Testing

`apps/api/src/services/storage.test.ts` (no DB: type detection, limits, path guard) and
`apps/api/src/routes/documents.test.ts` (uploads the four POC sample files; dedupe incl. concurrent
double upload, empty 400, 413, 415, roles, isolation, delete with Chroma down keeps row and file,
workspace delete removes the folder).

## Out of scope and follow-ups

Ingestion queue and reindex (#16), status stream (#17), folders and `PATCH` (move, retag), embedding
settings lock, pagination.

## Docs updated

None needed: `docs/api-schema.md` and the architecture's ingestion section already described this.
