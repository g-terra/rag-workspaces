---
title: Import and manage documentation websites in the admin UI
date: 2026-11-23
pr: pending
status: proposed
areas: [admin, docs]
---

# Import and manage documentation websites in the admin UI

## Summary

The Documents page gains **Add website** and a **Websites** list above the library. An editor imports a
docs site with a start URL, a page limit and paths to leave out. Each site's row shows its crawl's
progress live and offers **Crawl again** and **Remove**. Web pages carry a globe in the library and a link
to the page, and the playground's sources and passage dialog link cited pages.

## Why

The backend (docs/specs/2026-11-23-docs-website-import.md) and citation links
(docs/specs/2026-11-23-website-citations.md) are API-only. People import sites from the admin UI, so this
is where the feature becomes usable.

## Design

- `apps/admin/src/sites/sites.ts`: pure helpers (status label and tone, a one-line progress summary that
  leaves out zero counts, `displayUrl`, parsing the "Leave out" box), unit tested.
- `apps/admin/src/sites/queries.ts`: `useSites` (refetches every 2 s while any site is queued or
  crawling, then stops), `useAddSite`, `useCrawlSite`, `useRemoveSite`.
- `apps/admin/src/components/websites.tsx`: the `Websites` section (hidden when there are none) and the
  `AddWebsiteDialog`. Removing asks for confirmation; the removed pages leave the library through the
  existing document status stream, which already announces each removal.
- `routes/documents.tsx`: Add website next to Upload (editors), the section, a globe on `web` rows, and
  the page link in the detail panel. The empty state offers both.
- Playground: a source shows the page's address, and the passage dialog has **Open the page**. The source
  card stays a single button (a link inside a button is invalid HTML), so the link lives in the dialog.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Poll the sites list while a crawl runs | A new SSE event for site progress | Counters change once a second at most; polling a small list every 2 s only while crawling needs no API change |
| Websites as a section of the Documents page | A separate Websites page in the sidebar | Pages are documents; one place to see both, and no new navigation |
| No folder or depth fields in the dialog | Every option the API takes | Folders have no UI yet and depth rarely matters with a sitemap; the API still takes both |

## Interfaces and contracts

- **HTTP API**: None (uses the routes from the import and citations specs).
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

- `apps/admin/src/sites/sites.test.ts`: crawling states, badge mapping, progress text, URL display, and
  "Leave out" parsing (comma or line separated, deduplicated, each must start with `/`).
- Format, lint, typecheck and the admin unit suite. The end-to-end check of a crawl on the running stack
  comes with the smoke test follow-up.

## Out of scope and follow-ups

A smoke test that imports a stub docs site on the compose stack; editing a site's limits from the UI.

## Docs updated

`docs/guide/adding-material.md` (a Websites section replaces the "coming soon" note, and the Documents
paragraph mentions the globe and link).
