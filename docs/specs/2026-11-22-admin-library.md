---
title: Live document library with download, reindex and delete in the admin UI
date: 2026-11-22
pr: pending
status: proposed
areas: [admin]
---

# Live document library with download, reindex and delete in the admin UI

## Summary

`/w/<slug>/documents` lists every document in the workspace, newest first, with its type, passage
count, status and when it last changed. Status tabs and a title search narrow the list. Selecting a row
opens a detail panel (id, file name, size, passages, attempts, shortened SHA-256, the error of a failed
document) with Download for everyone and Reindex (Retry when failed) and Delete for editors and admins.
The list stays live through the same status stream as the upload page. The sidebar's "Workspace" section
now shows "Documents" to everyone with access. Follows `2026-11-22-admin-live-status.md`, whose
`useDocumentEvents()` hook it reuses.

## Why

Milestone M4 in `docs/work-breakdown.md`. The scope agreed with the owner: "a document list with
download, delete and reindex". The routes are in `2026-11-20-documents.md` (list, file, delete) and
`2026-11-20-ingest-queue.md` (reindex, `409` while a document is being ingested). Layout and copy follow
the approved "Documents" mock, without folders, Move and tags (the API has none yet).

## Design

1. **Route and nav** (`src/router.tsx`, `src/components/workspace-nav.tsx`). `documents` is a child of
   `/w/:slug`. "Documents" shows for every access level; "Upload" still only for editors and admins.
   The upload page's session list gains "View in library", and the library's top bar an "Upload"
   button for editors (`TopBar` now takes the page's own actions as children).
2. **Data** (`src/documents/queries.ts`). `useLiveDocuments(slug)` reads `GET
   /v1/workspaces/<slug>/documents` into TanStack Query (key `['workspaces', slug, 'documents']`) and
   calls `useDocumentEvents()` to patch that cache with each event through `applyDocumentEvent()`
   (`src/documents/library.ts`): a `document` event replaces a known document in place (unless the cache
   holds a newer copy by `updatedAt`) or puts a new one first; a `removed` event drops it; a `snapshot`
   merges the unfinished documents.
3. **Table** (`src/routes/documents.tsx`). `filterDocuments()` applies the tab (All, Ready, In progress
   = queued, transcribing or processing, Failed) and a case-insensitive title search, in the browser.
   `librarySummary()` gives "N documents · P passages · size" from the list; `formatUpdated()` shows
   "just now", "N min ago", "N h ago", then "3 Nov" (with the year when it isn't this year).
4. **Download** (`useDownloadDocument`). `fetch` of `.../documents/<id>/file` with the bearer token, then
   a blob URL clicked through a temporary `<a download>`. The name comes from `content-disposition`
   (`filenameFromDisposition()` reads the API's `filename*=UTF-8''…`), falling back to `fileName`.
5. **Reindex and Delete** (`useReindexDocument`, `useDeleteDocument`). `POST .../reindex` and `DELETE
   .../<id>` through `api`; on success the cache is updated at once (the stream's own event follows and
   changes nothing). Delete asks first in a dialog (`ui/dialog.tsx`). Errors, including the API's `409`
   "This document is being ingested right now…", show in the panel or the dialog.
6. **Empty state**. No documents: editors see "Upload files", readers "Nothing has been uploaded to this
   workspace yet".

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Patch the query cache from events | Refetch the list on each event | No request per status change; the list and the events carry the same `Document` |
| Filters and search in the browser | `?status=` on the API | The API has no search and no pagination yet; one list serves every tab without a round trip |
| Summary computed from the list | Leave it out until the API has `stats` | Exact for what is listed and free; the size is the sum of the uploads, not disk use |
| Download through `fetch` and a blob | `<a href>` to the file route | A link can't send the bearer token |
| Events while the first list load is pending are dropped | Buffer them | The list read happens at the same moment and is current; a missed change only shows on the next event or visit |
| Reindex label "Retry" on failed documents | Always "Reindex" | Matches the mock and the upload page |
| No row selected at first | Select the first row | A panel about a document nobody picked is noise; the panel says how to fill it |

## Interfaces and contracts

- **HTTP API**: None changed. The UI calls `GET /api/v1/workspaces/{slug}/documents`, `GET
  .../documents/{id}/file`, `POST .../documents/{id}/reindex` and `DELETE .../documents/{id}` with the
  bearer token, plus the events stream.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None new; the library reads the `snapshot`, `document` and `removed` events.

## Operations

Existing installs: `docker compose up -d --build web`. Delete is permanent (file, row and vectors), hence
the confirmation.

## Testing

- `apps/admin/src/documents/library.test.ts`: events applied to the list (new first, in place, older copy
  ignored, snapshot merge, removal); tabs and search; the summary with singular and plural; relative and
  short dates; the short SHA; file names from `content-disposition` in both forms.
- `apps/admin/e2e/library.spec.ts` (real stack): uploads a fixture through the API, opens Documents from
  the sidebar, waits for Ready live, checks the summary, the tabs and the search, opens the panel,
  downloads the file and compares its name and bytes, reindexes and sees the row go back through the
  queue to Ready without a reload, cancels then confirms Delete, sees the empty state and follows its
  Upload link. The workspace is deleted afterwards.

By hand: as a reader, check that Documents and Download are there and Upload, Reindex and Delete are not.
Reindex a long PDF and press Reindex or Delete again while it is processing to see the API's `409`
message.

## Out of scope and follow-ups

Folders, Move, tags and transcripts from the mock (not in the API yet). Pagination and server-side
search, when workspaces grow large. Bulk actions.

## Docs updated

`README.md` (the library in the admin UI).
