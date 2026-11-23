---
title: Split documents at paragraph, line and sentence breaks
date: 2026-11-23
pr: pending
status: in review
areas: [flows, langflow, docs]
---

# Split documents at paragraph, line and sentence breaks

## Summary

The ingest flow's `Split` node is now our own `WorkspaceTextSplitter`
(`langflow/components/rag_workspaces/text_splitter.py`). It cuts text at paragraph breaks first, then line
breaks, then sentence ends, then spaces, so a numbered list or a definition that fits in a chunk stays in one
chunk with the sentence that introduces it. Chunk size and overlap are unchanged (800 and 100 by default,
per workspace). Existing documents get the new chunks when their workspace is reindexed.

## Why

Guilherme's evaluation on the OUC material (2026-11-23) found answers to list questions incomplete, with
passages cut off in the middle of a list. The `Split` node was Langflow's Split Text with its separator set
to a space. That splitter cuts at one separator only, so it merged words up to 800 characters and cut
wherever the limit fell, in the middle of a list item as often as anywhere else. Shown on the same text in
Langflow's Python (a 600-character paragraph, then an eight-item list): the old split ended one chunk at
"5. Step 5: eliminate" and started the next at item 4; the new split gave the paragraph in one chunk and
the heading with all eight items in the next.

The tuning work on Guilherme's Mac found 800/100 to be the best size, so only where the cut falls changes.

## Design

1. `WorkspaceTextSplitter` takes the loader's rows (a PDF page, a transcript segment or a whole text file
   each) and splits each row on its own with LangChain's `RecursiveCharacterTextSplitter`, separators
   `\n\n`, `\n`, `. `, `? `, `! `, `; `, space, then characters. Sentence ends stay with their sentence
   (`keep_separator="end"`). Every chunk keeps its row's metadata (`page`, `start_seconds` and the rest),
   as Split Text did.
2. `flows/ingest.json`: the `Split` node now has this component's type and code. The node id, its
   `chunk_size` and `chunk_overlap` fields and its output name stay the same, so the API's tweaks
   (`apps/api/src/services/ingest.ts`) do not change. The drift test in `apps/api/src/flows.test.ts` checks
   that the embedded code matches the file.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Recursive split by boundary size | Split Text with `\n` as separator | One separator either cuts mid-sentence (space) or leaves a long line or paragraph whole, past the chunk size and the embedding model's comfort (newline). |
| Our own component | Langflow's Recursive Character Text Splitter component | It returns documents without our row metadata handling, and our component keeps the node id, fields and output the API relies on. |
| Keep 800/100 | Larger chunks so long lists fit | The tuning measurements found 800/100 best. A list longer than one chunk still spans two, now cut between items. |
| Split each row on its own | Join the pages first | Keeps the page number of every chunk exact, as before. A list across a page break stays split there. |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None. `chunkSize` and `chunkOverlap` mean the same as before.
- **Data**: documents ingested after this change get different chunk boundaries, and usually a few more or
  fewer passages. Passage ids are still `<document id>:<chunk index>`.
- **Langflow**: the `Split` node in `rw-ingest` changes type to `ext:rag_workspaces:WorkspaceTextSplitter`.
  Node ids and tweaks are unchanged.
- **Events and logs**: None.

## Operations

Restart Langflow and the API to load the new flow, then reindex each workspace whose documents should be
split the new way (`POST /v1/workspaces/{slug}/reindex`, no body). Workspaces not reindexed keep working
with their old chunks.

## Testing

- `scripts/smoke/check.ts`, new step: a Markdown file with a 600-character paragraph and a six-item list
  gets a passage holding the heading and every item. It failed with Split Text (the list was cut after the
  first chunk's 800 characters) and passes now.
- `apps/api/src/flows.test.ts`: the `Split` node carries the component's current code.
- The existing smoke steps still pass: PDF pages, DOCX, Markdown, reindex, folders, transcripts with start
  times.

## Out of scope and follow-ups

- Embedding task prefixes, hybrid keyword search and splitting multi-part questions, which the tuning work
  also asked for, are separate PRs.
- Joining text across PDF page breaks.

## Docs updated

`flows/README.md` (the `Split` row).
