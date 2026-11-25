---
title: Check why each custom Langflow component is needed against the 1.13.3 source
date: 2026-11-25
pr: pending
status: proposed
areas: [docs, flows]
---

# Check why each custom Langflow component is needed against the 1.13.3 source

## Summary

`poc/STOCK-COMPONENTS.md` records, for each custom component in `langflow/components/rag_workspaces/`,
whether the reason we gave for not using a stock Langflow component holds in the Langflow 1.13.3 source,
with permalinks pinned to the release commit. Three reasons are confirmed and three only partly, so the
docstrings of `text_splitter.py` and `lmstudio_embeddings.py` are corrected, and the flows that embed
those components carry the new code. Nothing changes at run time.

## Why

The COS512 report has to justify the custom components with sources. The reasons so far lived in
`poc/RESULTS.md` (F1, F2, F7), `docs/decisions.md` decision 20 and the component docstrings, from what the
spike observed, not from reading Langflow's code. Reading the code showed two of them overstated: a stock
Recursive Character Text Splitter exists, Split Text does keep row metadata, and the newer Embedding Model
node already turns off the length check that broke LM Studio. Rule 6 (keep docs true) asks for the
correction.

## Design

1. `poc/STOCK-COMPONENTS.md`: one section per claim with a verdict (confirmed, partly, wrong), the
   evidence as links to `github.com/langflow-ai/langflow` at commit `55c4398` (tag `v1.13.3`) with line
   ranges, and a one-line wording for the report. docs.langflow.org was unreachable from the checking
   environment, so documentation is cited from its source files in the same repository.
2. `poc/RESULTS.md` (top of Findings) and `poc/README.md` link to it.
3. `langflow/components/rag_workspaces/text_splitter.py` and `lmstudio_embeddings.py`: docstrings only.
4. `flows/ingest.json`, `flows/retrieve.json`, `flows/answer.json`, `flows/chat.json`: the embedded
   `template.code.value` of the `Split` and `Embeddings` nodes replaced with the new file contents, as the
   drift test in `apps/api/src/flows.test.ts` requires.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Keep both components, correct the docstrings | Switch to the stock Recursive Character Text Splitter or the Embedding Model node | The prefixes and the loader's table input still need our code, and the API's tweaks depend on these nodes' fields. Switching is untested and not what was asked. |
| Cite the docs' source files in the Langflow repo | Cite docs.langflow.org pages | The site couldn't be fetched to check; the source at the release commit is the same text and the link can't drift. |
| A separate file in `poc/` | Rewrite F1, F2 and F7 in `RESULTS.md` | `RESULTS.md` records what the spike saw on 2026-11-20; the check is later evidence, so it is added beside it and linked. |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: The embedded code of the `Split` node (`flows/ingest.json`) and the `Embeddings` nodes
  (`ingest`, `retrieve`, `answer`, `chat`) changes in its docstring only. Node ids, fields and outputs are
  unchanged.
- **Events and logs**: None.

## Operations

None. Langflow re-imports the flows on restart (`LANGFLOW_LOAD_FLOWS_PATH`); the only difference is the
docstring.

## Testing

`apps/api/src/flows.test.ts` ("carries the current code of our custom components") checks the flows embed
the edited files. `pnpm test:langflow` runs the components' unit tests, unaffected by a docstring. By hand:
open each permalink in `poc/STOCK-COMPONENTS.md` and check the lines say what the row claims.

## Out of scope and follow-ups

Trying the stock Embedding Model node with the "OpenAI Compatible" provider, and the File component's
Docling mode, was not done. Neither would remove the need for task prefixes or per-page rows.

## Docs updated

`poc/RESULTS.md` and `poc/README.md` link to the new file. `docs/decisions.md` decision 20 (Chroma) is
confirmed as written and needs no change.
