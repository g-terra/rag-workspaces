---
title: Read PDF pages with very long content streams
date: 2026-11-23
pr: "#79"
status: in review
areas: [flows, langflow]
---

# Read PDF pages with very long content streams

## Summary

Two of Guilherme's PDFs failed to ingest with pypdf's "Reached maximum number of tokens per stream". The
Workspace Document Loader now allows pypdf 25 times more parsing work per page. A page that still goes
over is skipped and named in the component's status, instead of failing the whole document.

## Why

pypdf 6 (6.21.4 in Langflow 1.13.3) stops parsing a page's content stream after 2,000,000 tokens
(`Configuration.stream_parsing_work_maximum_count`). This guards against malicious files, but slide decks
with drawn diagrams can pass it. One such page made the whole document `failed`.

## Design

`langflow/components/rag_workspaces/document_loader.py` reads PDFs inside
`pypdf.apply_configuration(stream_parsing_work_maximum_count=PDF_STREAM_PARSING_BUDGET)`, which is
50,000,000. The override applies only within that block, through a context variable, so nothing else in
the Langflow process changes. Each page's `extract_text()` catches `LimitReachedError`:

- The page is skipped and its number is listed in the component's status.
- If every page is skipped or empty, the error says which pages were too complex.

The same code is embedded in `flows/ingest.json`, and the drift test checks that they match.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Raise the budget to 50 million | Turn the limit off | The limit protects the shared Langflow process from runaway or hostile files. 25 times the default covers dense real pages and still bounds the work. |
| Skip a page that still goes over | Fail the document, as before | One diagram-heavy page shouldn't keep the other pages out of search. |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None. The budget is a constant in the component.
- **Data**: None.
- **Langflow**: `rw-ingest` behaves the same. Only the loader's code changes.
- **Events and logs**: the loader's status names skipped pages.

## Operations

Restart Langflow (or the stack) to load the new flow. Then retry the failed documents with reindex
(`POST /v1/workspaces/{slug}/documents/{id}/reindex`, or "Retry" in the admin UI).

## Testing

- The failure was reproduced in the Langflow 1.13.3 image with a generated one-page PDF that has a
  million `0 0 m` operators. `extract_text()` raised `LimitReachedError` by default and returned the
  text with the raised budget.
- `scripts/smoke/check.ts` gained the step "a PDF page with a very long content stream is still read",
  which uploads that PDF. With the old loader it fails ("Reached maximum number of tokens per stream."),
  and with this change it passes.

## Out of scope and follow-ups

None.

## Docs updated

None needed: no documented behaviour changes.
