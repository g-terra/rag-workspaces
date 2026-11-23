---
title: Find every best passage in a workspace-wide search
date: 2026-11-23
pr: pending
status: in review
areas: [api, flows, docs]
---

# Find every best passage in a workspace-wide search

## Summary

Workspace collections in Chroma are now created with HNSW settings that find the true best passages:
`ef_search` 400, `ef_construction` 200 and `max_neighbors` 32, instead of Chroma's defaults (100, 100, 16).
With the defaults, a search over the whole workspace missed about one passage in eight of the true top 20,
while the same search inside one folder found them. Existing workspaces get the new settings when they are
reindexed.

## Why

Evaluating answers on the OUC material (2026-11-23), Guilherme saw that "What is a Skolem constant?"
answered from weaker passages when asked across the whole workspace: four passages that scored above the
global top-20 cutoff were found by a folder-scoped search and not by the global one. Similarity search is
approximate. Chroma walks an HNSW graph, and how wide it looks (`ef_search`) and how connected the graph is
(`max_neighbors`, `ef_construction`) decide how often the walk misses a true neighbour. A folder filter
shrinks the candidate set, so the walk misses less, which is the pattern Guilherme saw.

The root cause was confirmed by measurement before the fix (see Testing): 8,000 clustered 384-dimension
vectors in four folders, 30 queries, top 20, compared with an exact brute-force ranking.

| HNSW settings (`ef_search`, `ef_construction`, `max_neighbors`) | Workspace-wide recall | One-folder recall |
| --------------------------------------------------------------- | --------------------- | ----------------- |
| Chroma defaults (100, 100, 16)                                  | 0.880                 | 0.967             |
| Defaults, but ask Chroma for 100 and keep 20                    | 0.855                 | n/a               |
| 200, 100, 16                                                    | 0.938                 | 0.992             |
| 400, 100, 16                                                    | 0.982                 | 1.000             |
| 200, 200, 32                                                    | 0.997                 | 1.000             |
| **400, 200, 32 (chosen)**                                       | **1.000**             | **1.000**         |

## Design

1. `COLLECTION_HNSW` in `apps/api/src/services/chroma.ts` holds the settings, and `ensureCollection` (used
   when a workspace is created and when it is reindexed) sends them as the collection's `configuration.hnsw`.
2. `langflow/components/rag_workspaces/chroma_upsert.py` creates the collection itself when it is missing
   (`get_or_create`), so it has the same `COLLECTION_HNSW` and uses it. Its code is embedded in
   `flows/ingest.json`, which is synced (the drift test in `apps/api/src/flows.test.ts` checks).
3. `apps/api/src/services/chroma.test.ts` checks that both copies hold the same values, so whichever side
   creates a collection first, it gets the same index.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Raise `ef_search`, `ef_construction` and `max_neighbors` together | Only `ef_search` (can be changed on a live collection) | `ef_search` 400 alone reached 0.982. A better-connected graph closes the rest, and costs little at the size of a course's material. |
| Settings fixed at creation, applied by reindex | Change existing collections in place with Chroma's `PUT … new_configuration` | Only `ef_search` can be changed in place, and changing it on a live collection did not change recall in the test. `max_neighbors` and `ef_construction` shape the graph, which is only rebuilt with the collection. |
| Fixed values in code | Workspace settings or `.env` | Nobody should have to tune an index to get correct search. Fewer knobs. |
| Ask Chroma for exactly `k` results | Over-fetch (ask for 100, keep 20) | Over-fetching did not help (0.855): the miss happens in the graph walk, not in the cut. |

Cost: a wider search and a denser graph. Each query visits more nodes and the index uses roughly twice
the memory for links. For thousands of passages per workspace that is milliseconds and megabytes.

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: new Chroma collections carry the new HNSW settings. Collections created before this change keep
  Chroma's defaults until the workspace is reindexed.
- **Langflow**: `ChromaWorkspaceUpsert` code changes inside `flows/ingest.json`. Node ids and tweaks are
  unchanged.
- **Events and logs**: None.

## Operations

After upgrading, reindex each existing workspace once (`POST /v1/workspaces/{slug}/reindex` with no body,
or the Reindex button on the workspace settings page). This re-embeds every document, which takes as long as
the first ingestion did. Restarting the API and Langflow picks up the code.

## Testing

- `apps/api/src/services/chroma.test.ts`: `ensureCollection` sends the settings, and `chroma_upsert.py`
  holds the same values.
- `apps/api/src/flows.test.ts`: `flows/ingest.json` carries the new upsert code.
- `scripts/smoke/check.ts`: after the workspace reindex, the rebuilt collection reports the new settings
  (failed against Chroma's defaults before the fix, passes after).
- The recall measurement above was a throwaway script against the smoke stack's Chroma 1.5.9. It is not
  committed, because recall on synthetic vectors is not a stable unit test.
- By hand: reindex the OUC workspace and ask "What is a Skolem constant?" across the whole workspace and
  inside its course folder. The workspace-wide citations should include the passages the folder search
  finds.

## Out of scope and follow-ups

- Refusals marked as grounded and multi-part questions are separate fixes from the same evaluation.
- A warning in the admin UI for workspaces still on the old index settings.

## Docs updated

`docs/architecture.md` (search recall note), `docs/setup.md` (troubleshooting row for existing workspaces).
