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
count, status and when it last changed. Status filters and a title search narrow the list. Selecting a row
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
   calls `useDocumentEvents()` to patch that cache with each event through `applyToLibrary()` and
   `applyDocumentEvent()` (`src/documents/library.ts`): a `document` event replaces a known document in
   place (unless the cache holds a newer copy by `updatedAt`) or puts a new one first; a `removed` event
   drops it; a `snapshot` merges the unfinished documents and also invalidates the query, so the list is
   read again. The snapshot holds only unfinished documents, so that reload is what shows documents that
   finished or were deleted while the stream was down; it also covers the first load, since events that
   arrive while it is pending find no cache to patch.
   The page is keyed by workspace slug, so switching workspace starts with no selection, filter or
   search.
3. **Table** (`src/routes/documents.tsx`). `filterDocuments()` applies the status filter (All, Ready, In
   progress = queued, transcribing or processing, Failed) and a case-insensitive title search, in the
   browser. The filters are toggle buttons (`aria-pressed`) in a group labelled "Status". The selected
   row's title button has `aria-current="true"`, and the Updated cell's `title` gives the absolute date
   and time.
   `librarySummary()` gives "N documents · P passages · size" from the list; `formatUpdated()` shows
   "just now", "N min ago", "N h ago", then "3 Nov" (with the year when it isn't this year).
4. **Download** (`useDownloadDocument`). `fetch` of `.../documents/<id>/file` with the bearer token, then
   a blob URL clicked through a temporary `<a download>`, named with the document's `fileName`.
5. **Reindex and Delete** (`useReindexDocument`, `useDeleteDocument`). `POST .../reindex` and `DELETE
   .../<id>` through `api`; on success the cache is updated at once (the stream's own event follows and
   changes nothing). Delete asks first in a dialog (`ui/dialog.tsx`); after a confirmed delete, focus
   moves to the table (or to the page heading once the list is empty), since the button that opened the
   dialog is gone. While a document is processing or transcribing (`isIngesting()`), Reindex and Delete
   are disabled with the hint "Reindex and Delete are available once ingestion finishes.", since the API
   would answer `409`. Other errors show in the panel or the dialog.
6. **Empty state**. No documents: editors see "Upload files", readers "Nothing has been uploaded to this
   workspace yet".

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Patch the query cache from events | Refetch the list on each event | No request per status change; the list and the events carry the same `Document` |
| Filters and search in the browser | `?status=` on the API | The API has no search and no pagination yet; one list serves every filter without a round trip |
| Summary computed from the list | Leave it out until the API has `stats` | Exact for what is listed and free; the size is the sum of the uploads, not disk use |
| Download through `fetch` and a blob | `<a href>` to the file route | A link can't send the bearer token |
| Reload the list on every snapshot | Buffer events while the first load is pending; fetch only what the snapshot misses | One list request per (re)connect covers the first load, reconnects and deletions alike, with no buffering logic |
| Disable Reindex and Delete while ingesting | Let the API answer `409` | The person sees why before pressing, not after |
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
  ignored, snapshot merge, removal); filters and search; the summary with singular and plural; relative
  and short dates; the short SHA; which statuses count as ingesting.
- `apps/admin/src/documents/queries.test.ts`: `applyToLibrary()` patches a real `QueryClient`'s list
  with `document` and `removed` events, and invalidates it on a snapshot.
- `apps/admin/e2e/library.spec.ts` (real stack): uploads two fixtures through the API, opens Documents
  from the sidebar, waits for Ready live, checks the summary, the filters (`aria-pressed`) and the
  search, opens the panel (`aria-current`, the Updated cell's `title`), downloads the file and compares
  its name and bytes. It reindexes, waits for the `POST …/reindex` answer, then polls the statuses the
  row showed until they hold Queued or Processing followed by Ready, without a reload. It cancels then
  confirms Delete and sees focus move to the table, deletes the other document, sees the empty state
  with focus on the heading, and follows its Upload link. The workspace is deleted afterwards.

By hand: as a reader, check that Documents and Download are there and Upload, Reindex and Delete are not.
Reindex a long PDF and press Reindex or Delete again while it is processing to see the API's `409`
message.

## Out of scope and follow-ups

Folders, Move, tags and transcripts from the mock (not in the API yet). Pagination and server-side
search, when workspaces grow large. Bulk actions.

## Docs updated

`README.md` (the library in the admin UI).
