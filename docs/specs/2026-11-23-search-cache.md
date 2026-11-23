---
title: keep the search cache across Langflow runs
date: 2026-11-23
pr: "#90"
status: in review
areas: [flows, langflow, docs]
---

# Keep the search cache across Langflow runs

## Summary

The search component's cache of keyword and vector indexes now survives from one run to the next. Before, every search
rebuilt both indexes from Chroma: with exact vector search
([2026-11-23-exact-vector-search.md](2026-11-23-exact-vector-search.md)) that cost about 4 s per search and several hundred
MB of memory, twice per answer. Now only the first search in a collection pays it, and later ones take milliseconds.

## Why

On the OUC tuning index (12,911 passages), five back-to-back `GET /passages` calls each took 1.9 to 3.3 s, and answers went
from about 3 s to about 6.5 s after #89. Langflow's worker was also killed for memory three times
("Worker was sent SIGKILL! Perhaps out of memory?"), twice turning answers into 503s. The cause: Langflow builds a custom
component from its source code on every run (`lfx.custom.eval.eval_custom_component_code` executes the module in a fresh
globals dict), so the module-level `_INDEXES` dict in `chroma_search.py` was new and empty each time.

## Design

All in `langflow/components/rag_workspaces/chroma_search.py`:

1. A module named `rag_workspaces_search_cache` is registered in `sys.modules` the first time the component's source runs.
   Every later run finds it there and uses its `indexes` dict and `lock`, so the cache is shared by every run in the worker.
2. `_indexes` reads the collection's count, then takes the lock while it checks or rebuilds the indexes (`_fresh_indexes`).
   The retrieve and answer flows that serve one question therefore build the index once, not twice at the same time.
3. `_vector_index` turns each page of vectors into a float32 numpy array as soon as it arrives instead of keeping Python
   floats, which take about eight times the memory, and `VectorIndex` stacks those rows.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Share through `sys.modules` | A file cache; caching in the API | Works inside the existing component, no new service or files, no serialisation |
| One lock for all collections | A lock per collection | Builds are rare after the first; simpler, and keeps peak memory to one build at a time |
| Convert vectors per page | Keep lists until the end | Lower peak memory, same result |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None. The cache is in memory in the Langflow worker.
- **Langflow**: the `Search` node's code in `flows/retrieve.json`, `flows/answer.json` and `flows/chat.json` is refreshed from
  the component. Same inputs, outputs and node ids.
- **Events and logs**: None.

## Operations

Restart Langflow to load it; no reindex. The cache lasts until Langflow restarts. Editing the component in the flow editor
keeps the old cache, which holds only data, so that is safe.

## Testing

One-off checks in the smoke stack's Langflow container, building the component from its source with
`eval_custom_component_code` as Langflow does:

- Before: an entry put in the cache by one build was gone in the next. After: the next build sees it.
- An 18,000 × 768 collection, three runs in a row. Before: 4.5 s, 4.0 s, 4.5 s, and peak memory grew 820 MB. After: 4.5 s,
  13 ms, 6 ms, and peak memory grew 377 MB.
- Exactness is unchanged: 0 of the exact top 10 missing over 8 queries.

`apps/api/src/flows.test.ts` checks the flows' code matches the component, and `pnpm smoke` runs search end to end.

## Out of scope and follow-ups

- Sharing the cache between several Langflow workers or keeping it across restarts.
- Building the index ahead of the first search (for example, when a document finishes ingesting).

## Docs updated

`flows/README.md`: where the cache lives and why.
