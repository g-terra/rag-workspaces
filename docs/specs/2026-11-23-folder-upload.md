---
title: upload a whole folder from the admin UI
date: 2026-11-23
pr: pending
status: proposed
areas: [admin, docs]
---

# Upload a whole folder from the admin UI

## Summary

The admin UI's Upload page takes whole folders. Drop one or more folders on the drop zone, or pick one
with the new **Browse folder** button. The page walks every subfolder and uploads each supported file
through the existing per-file upload: same duplicate check, same ingest queue, same live status rows.
Each row shows the file's path inside the folder (`COS512/Week 1/intro.pdf`). Files the platform can't
read (`.pptx`, `.zip` and so on) are skipped with one summary line instead of a row each, and hidden files
such as `.DS_Store` are ignored. The files land at the top level of the workspace. The API is unchanged.

## Why

Guilherme asked for it (2026-11-23): "add support to upload a whole folder". His course material lives in
folders of dozens of files (lecture PDFs, notes, recordings), and the page only took files picked one by
one.

## Design

1. **Picking** (`apps/admin/src/routes/upload.tsx`): a second hidden `<input type="file" webkitdirectory>`
   behind a **Browse folder** button. The browser gives every file under the chosen folder, each with
   `webkitRelativePath` (`COS512/Week 1/intro.pdf`).
2. **Dropping**: the drop handler reads `dataTransfer.items` while the event is live (the list is emptied
   once the handler returns), takes each item's `webkitGetAsEntry()`, then walks directory entries with
   `walkEntries` (`apps/admin/src/documents/folder-upload.ts`). A directory reader returns its entries in
   batches (about 100 at a time in Chrome), so `readEntries` is called until it returns none. A dropped
   plain file comes back with its own name as its path, so files and folders can be dropped together.
   Without entry support the page falls back to `dataTransfer.files`, as before.
3. **Planning** (`planUpload` in `folder-upload.ts`, pure). From `{ file, path }` pairs it:
   - drops hidden files and anything under a hidden folder (a path segment starting with `.`, such as
     `.git/` or `.DS_Store`) and the system files `Thumbs.db` and `desktop.ini`;
   - skips files inside a folder whose extension isn't supported, counted per extension for the summary
     ("Skipped 3 files that can't be indexed: 2 .pptx, 1 .zip");
   - keeps everything else, named by its path. A file picked or dropped on its own that isn't supported
     still gets a rejected row, as before, because the person chose that file.
4. **Uploading**: unchanged. Each file is its own `POST /v1/workspaces/{slug}/documents` through
   `uploadFile` (`apps/admin/src/documents/upload.ts`), three at a time through the page's limiter, with a
   progress bar and live status per row. A file already in the workspace (same SHA-256) is skipped as a
   duplicate. The 2 GB per-file check (`checkFile`) runs before anything is sent. The document's
   `fileName` is still the base name; the path is only on the page.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Files land at the top level, no workspace folders made | One workspace folder per dropped folder; one per subfolder (`COS512 / Week 1`) | Guilherme's choice on a decision card (2026-11-23). It is also the smallest change: no folder lookups or creation, and the admin UI has no folders screen yet |
| Reuse the per-file upload, one request per file | A new bulk endpoint, or one multipart request with every file | The API refuses a multipart request as a whole when one file is bad, and a folder of lectures can be many GB; per-file requests give per-file progress, errors and retry, and the dedup and queue are already there |
| Skip unsupported files inside folders with one summary line | A rejected row per file | A course folder can hold dozens of slides and archives; a row each buries the files that matter |
| Rows show the relative path | Base name only | Two `notes.md` in different subfolders would look the same |

## Interfaces and contracts

- **HTTP API**: None. The page uses `POST /v1/workspaces/{slug}/documents` as before.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. A front-end change only.

## Testing

- `apps/admin/src/documents/folder-upload.test.ts`: `planUpload` (hidden and system files ignored,
  unsupported files in folders counted per extension, loose unsupported files kept for a rejected row);
  `skippedSummary` wording; `walkEntries` on fake directory entries, including nested folders and a
  reader that returns its entries over several calls; `filesFromInput` reading `webkitRelativePath`.
- `apps/admin/e2e/upload.spec.ts`: picks a fixture folder with **Browse folder**; its two supported files
  (one in a subfolder) reach Ready with their paths shown, and the `.pptx` is counted in the summary.
- By hand: `pnpm smoke --keep`, sign in at `http://localhost:18080`, open a workspace's Upload page and
  drop a folder from Finder.

## Out of scope and follow-ups

- Putting the files into workspace folders (declined for now; the folders API supports it if wanted).
- Pausing or cancelling a large folder upload other than leaving the page.

## Docs updated

`docs/architecture.md`: the admin UI line says it takes files or whole folders.
