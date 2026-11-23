---
title: Drag-and-drop upload with progress in the admin UI
date: 2026-11-22
pr: '#37'
status: merged
areas: [admin]
---

# Drag-and-drop upload with progress in the admin UI

## Summary

Editors and admins upload PDF, DOCX, TXT and MD files at `/w/<slug>/upload`, by dropping them on the page
or with "Browse files". Each file gets a row with an upload progress bar, then the API's answer: Queued
for a new document, "Skipped" for a file already in the workspace, or "Not uploaded" with the reason. The
sidebar gains a "Workspace" section with "Upload". Following each document through ingestion live comes
next, in `2026-11-22-admin-live-status.md`. This is the third admin UI PR in M4, after
`2026-11-22-admin-create-workspace.md`.

## Why

Milestone M4 in `docs/work-breakdown.md`: the admin UI against the real API. The scope agreed with the
owner: "drag-and-drop upload with a progress bar and live status per file". The API side is in
`2026-11-20-documents.md` (upload, dedupe, `413`/`415`). Layout and copy follow the approved "Upload"
mock, without its folder, tags and video parts (the API has none yet). The work is split in two to keep
each PR reviewable (rule 2): this one uploads, the next one follows ingestion over server-sent events.

## Design

1. **Route and nav** (`src/router.tsx`, `src/components/workspace-nav.tsx`). `upload` is a child of
   `/w/:slug`, so it gets the workspace from `useCurrentWorkspace()`. The sidebar's "Workspace" section
   shows "Upload" when the open workspace's `access` is `admin` or `editor`. A reader who opens the URL
   sees "You can't upload here" instead of the drop zone. `navItemClass` (`src/lib/utils.ts`) is shared
   with the "Admin" section.
2. **Picking files** (`src/routes/upload.tsx`). Native HTML5 drag and drop on the drop zone (`dragover`,
   `dragleave`, `drop`) and a hidden `<input type="file" multiple>` behind "Browse files". The input is
   cleared after each pick, so the same file can be picked again. While the upload page is open, `dragover`
   and `drop` anywhere on the page are cancelled, so a file dropped beside the zone doesn't open in the tab
   and leave the page. The page is keyed by workspace slug, so switching workspace starts an empty list.
3. **Checks before sending** (`src/documents/files.ts`). `checkFile()` refuses other extensions, empty
   files and files over 200 MB (the API's and nginx's default `MAX_UPLOAD_BYTES`) without a request. The
   API still checks the content, so a renamed binary is refused with `415`.
4. **Upload** (`src/documents/upload.ts`). One `POST /api/v1/workspaces/<slug>/documents` per file, as
   multipart with a `files` part, through `XMLHttpRequest`, because `fetch` can't report upload progress.
   Files go through a queue (`src/documents/queue.ts`) that sends at most 3 at a time, in drop order; the
   others show "Waiting". `sendAuthorized()` (`src/auth/authorized.ts`) fetches the bearer token with
   `getToken()` right before each send, so it can't expire while a file waits. On a `401` it renews the
   token once (`renewToken()`) and sends again; if that fails too it calls `endSession()`, the same path
   `api` takes on a `401`, and RequireAuth sends the person to sign in. All three are now on `useAuth()`
   (`src/auth/auth-provider.tsx`). `uploadErrorMessage()` puts failures in words: `413` "Too large", `415`
   "Not a supported file", `403`, network errors, else the API's detail, or its status text, or
   `HTTP <status>` when there is none.
   Leaving the page aborts the uploads in flight and drops the ones still waiting. While any file is
   waiting or uploading, closing or reloading the tab asks first (`beforeunload`).
5. **Rows** (`src/documents/session.ts`). `sessionReducer` keeps the rows of this page visit and the
   documents the uploads created or matched. `rowView()` gives each row its badge, the line under the name
   ("2 KB · 45%", "waiting for the ingest flow", the reason it was refused) and the progress bar;
   `sessionSummary()` gives "N uploaded, M uploading" (", K waiting" while any wait). Rows are newest
   drop first. A polite live region (`aria-live="polite"`) repeats the summary, so screen readers announce
   progress.
6. **Badges** (`src/components/status-badge.tsx`): the mock's colours per status, with a pulsing dot
   while uploading, transcribing or processing. A lifecycle legend (Queued → Processing → Ready, or
   Failed) sits under the drop zone, as in the mock.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| At most 3 uploads at once, token fetched per send | Send every dropped file at once | Dozens of parallel uploads crowd the connection and the browser's per-host limit, and a token fetched at drop time could expire before a late file is sent |
| One request per file | All dropped files in one request | The API accepts or refuses a request as a whole; one file per request lets each file succeed, fail or be skipped on its own, with its own progress |
| `XMLHttpRequest` for uploads | `fetch` | `fetch` can't report upload progress |
| Native drag and drop | `react-dropzone` | Three handlers and a file input cover it; no dependency |
| Session list in component state | Keep it in storage or the query cache | Agreed: leaving the page loses the list; the files are in the workspace |
| Client-side 200 MB check | Ask the API for its limit | Saves a long upload that would get `413`; a different server limit still answers `413`, shown in words |
| Status colours as Tailwind palette classes | New theme tokens | Seven colours used by one component; tokens come with the approved design's theme later in M4 |
| `getToken` on the auth context | A second API client for uploads | Same token source and renewal as `api` |
| Rows stop at the upload answer | Poll each document | The next PR follows ingestion over the stream the API already has; polling would be thrown away |

## Interfaces and contracts

- **HTTP API**: None changed. The UI calls `POST /api/v1/workspaces/{slug}/documents` (multipart
  `files`) with the bearer token.
- **Configuration**: None. The 200 MB client check mirrors `MAX_UPLOAD_BYTES`'s default.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Existing installs: `docker compose up -d --build web`. nginx already allows 200 MB bodies
(`docker/admin/nginx.conf`).

## Testing

- `apps/admin/src/documents/files.test.ts`: accepted and refused types, empty and oversized files, the
  error wording per status, byte formatting, status labels.
- `apps/admin/src/documents/queue.test.ts`: at most 3 at once, the next starts as one ends, a failed
  task frees its slot.
- `apps/admin/src/auth/authorized.test.ts`: the token is sent; a `401` renews once and sends again; a
  second `401`, or no renewed token, ends the session.
- `apps/admin/src/documents/upload.test.ts`: the reason for a refused upload, down to `HTTP <status>`.
- `apps/admin/src/documents/session.test.ts`: rows from waiting to uploading to uploaded, refused in the browser or by
  the API, duplicates, newest drop first, the summary.
- `apps/admin/e2e/upload.spec.ts` (real stack): creates a workspace through the API, opens Upload from
  the sidebar, picks a `.md` fixture (held 0.8 s so Uploading and the progress bar show) and sees Queued;
  drops a `.txt` fixture with a synthetic `drop` event and sees Queued; for both, polls `GET
  /documents/{id}` until the API says `ready`, which proves the upload fed ingestion. Picks the first file
  again and sees Skipped; sees a `.pptx` refused in the browser and a `.txt` with a NUL byte refused by
  the API (`415`). Deletes the workspace afterwards. `e2e/sign-in.ts` now holds the `bearer()` helper.

By hand: open `/w/<slug>/upload`, drop a few files including one over 200 MB and one `.pptx`. As a
reader, check the notice and that Upload is not in the sidebar.

## Out of scope and follow-ups

Following ingestion live, and Retry on a failed document (`2026-11-22-admin-live-status.md`). Folders,
tags, video and audio as in the mock: the API has none of them yet. Cancelling a single upload. The document
library. No reader account in the e2e run, so the reader notice is checked by hand.

## Docs updated

`README.md` (editors upload from the admin UI). `docs/architecture.md` (the admin stack no longer lists
`react-dropzone`: the UI uses native drag and drop).
