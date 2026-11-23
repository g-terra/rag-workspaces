---
title: preview PDFs in the app, on the cited page
date: 2026-11-23
pr: pending
status: in review
areas: [admin]
---

# Preview PDFs in the app, on the cited page

## Summary

A PDF can now be read inside the admin UI. The passage dialog (opened from a citation, a source card,
a search hit or a stored reply) has a **View page N** button for PDF passages. It opens the PDF on that
page, over the passage. The document library has a **Preview** button for PDFs. The file comes from the
existing download route, and the browser's own PDF viewer shows it, so nothing new is added on the
server.

## Why

Guilherme, 2026-11-23: "we need to have a pdf preview of the content in the ui". A citation's snippet is
a few hundred characters of extracted text with broken hyphenation. Seeing the page itself is how a
reader checks a claim. Builds on the citation dialog (`2026-11-23-admin-playground-ask.md`), the library
(`2026-11-22-admin-library.md`) and `GET
/v1/workspaces/{slug}/documents/{id}/file`.

## Design

1. `apps/admin/src/documents/queries.ts`: `fetchFile` is now shared by `useDownloadDocument` and the
   new `useDocumentFile(slug, id)`. That hook is a TanStack query for the file as a `Blob`, fetched with
   the bearer token, because a frame can't send one. Its key is `['workspaces', slug, 'document-file',
   id]`, outside the documents list key, so a library refresh doesn't download the file again. It never
   goes stale while cached.
2. `apps/admin/src/documents/preview.ts`: `previewSrc(objectUrl, page)` appends `#page=N`, the open
   parameter PDF viewers read. `canPreview(type)` is true for `pdf` only.
3. `apps/admin/src/components/document-preview-dialog.tsx`: `DocumentPreviewDialog` is a 90vh dialog
   holding an `<iframe>`, plus an "Open in a new tab" link. `PdfFrame` makes the object URL in an effect,
   sets it on the frame and the link through refs, and revokes it on cleanup. Using refs instead of state
   keeps StrictMode's second effect run working: it gets a fresh URL instead of a revoked one.
4. `apps/admin/src/playground/passage-dialog.tsx`: when the passage has a `page`, it shows **View page
   N**. Only PDF passages have pages (`packages/shared/src/passages.ts`). The preview dialog renders
   inside the passage dialog's content, so Radix stacks it: Escape or a click in the preview closes only
   the preview.
5. `apps/admin/src/routes/documents.tsx`: a **Preview** button in the selected document's panel, for
   PDFs. It opens the preview on the first page.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| The browser's built-in viewer in an iframe | pdf.js (`pdfjs-dist`) rendering pages to canvas | No dependency, and no 1 MB+ worker added to the bundle. Zoom, search and print work for free. pdf.js could highlight the cited sentence, but that wasn't asked for |
| Fetch with the token into a blob URL | A signed, short-lived file URL from the API; putting the token in the query string | Uses the existing route and auth unchanged. A token in a URL leaks into logs and history |
| Preview opens from the passage dialog, not directly from the chip | Chip opens the PDF straight away | The passage text stays the fast first look and works for every type. The page is one click further |
| PDFs only | Render DOCX, MD or TXT too | Those have no pages, and their passage text already is the content |
| Cache the blob per document | Fetch on every open | Opening several citations from one PDF shouldn't download it again. TanStack's default gc (5 min unused) frees it |

## Interfaces and contracts

- **HTTP API**: None. Uses `GET /v1/workspaces/{slug}/documents/{id}/file` (reader), whose
  `content-disposition: attachment` doesn't apply to a blob URL.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. A browser without a built-in PDF viewer (some mobile browsers, or one with it turned off) shows
an empty frame or offers a download. The "Open in a new tab" link and the library's Download button
still work.

## Testing

- `apps/admin/src/documents/preview.test.ts`: `previewSrc` with and without a page; `canPreview` for
  each type.
- `apps/admin/e2e/pdf-preview.spec.ts` (new) uploads `poc/samples/ouc/cos512-notes.pdf`, then checks:
  - the library's Preview opens a frame on a `blob:` URL;
  - a search hit's passage shows **View page N**, and the frame's URL ends `#page=N`;
  - Escape closes only the preview, leaving the passage open.

  Headless Chromium has no PDF viewer, so the test checks the frame's URL, not the rendered page.
- By hand: ask a question over a PDF and open a citation. Click **View page N** and check the viewer opens
  on that page, then try the library's Preview. Check Chrome and Safari.

## Out of scope and follow-ups

- Highlighting the cited passage on the page (needs pdf.js and text-layer matching).
- Previews for DOCX.
- The other fixes from the same request (markdown, mode help, conversation ids, settings defaults) are
  separate PRs.

## Docs updated

None needed: no long-lived doc describes the admin UI's document screens beyond the specs.
