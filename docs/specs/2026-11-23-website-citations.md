---
title: Link passages and citations to their web page
date: 2026-11-23
pr: "#120"
status: merged
areas: [api, mcp, docs]
---

# Link passages and citations to their web page

## Summary

Passages, search hits and citations gain `sourceUrl`: the address of the page a passage came from when its
document is a page of an imported website, and `null` otherwise. Answers and conversation replies store it
with each citation, and the MCP server's `ask` tool passes it on, so a person or an agent can open the page
an answer cites.

## Why

The docs-website import (docs/specs/2026-11-23-docs-website-import.md, section 5) makes each page a document
with `sourceUrl`. Its point is that citations link back to the page; until now only the document carried the
URL, so a client had to fetch every cited document to find it.

## Design

- `resolveHits` (`apps/api/src/services/passages.ts`) already reads cited documents' titles from Postgres;
  it now reads `source_url` in the same query. Search hits, answer and chat citations all go through it.
- `GET …/documents/{id}/passages` and `GET …/passages/{id}` (`apps/api/src/routes/passages.ts`, `fromChunk`)
  take it from the document row they already load.
- `Generator` (`apps/api/src/services/generate.ts`) copies it into each citation, which answers and messages
  store as JSON (`StoredCitation`). Citations stored before this change have no `sourceUrl`;
  `withStartSeconds` now reads a missing one as `null`, as it does for `startSeconds`.
- `apps/mcp/src/tools.ts` adds it to the citations of the `ask` tool.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Read the URL from Postgres when shaping passages | Write `source_url` into Chroma metadata at ingestion | Titles already come from Postgres this way; nothing changes in the flows, and no reindex is needed |
| Snapshot it in stored citations | Look it up when an answer is read | Citations are snapshots already (title, snippet), so an answer reads the same after its page is removed |

## Interfaces and contracts

- **HTTP API**: `Passage`, `ScoredPassage` and `Citation` gain `sourceUrl: string | null` (search, document
  passages, one passage, answers, conversation messages, the stream's `citations` event).
- **Configuration**: None.
- **Data**: `StoredCitation` (JSON in `answers.citations` and `messages.citations`) gains optional
  `sourceUrl`. No migration.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. Older stored citations read `sourceUrl: null`.

## Testing

- `apps/api/src/routes/passages.test.ts`: a hit on a `web` document carries its URL; upload hits carry `null`.
- `apps/api/src/routes/answers.test.ts`: citations carry `sourceUrl: null` for an upload.

## Out of scope and follow-ups

Showing the link in the admin UI (the websites admin UI follow-up).

## Docs updated

`docs/api-schema.md` (answer example and the citations paragraph).
