---
title: rank search by exact cosine similarity
date: 2026-11-23
pr: "#89"
status: merged
areas: [flows, langflow, docs]
---

# Rank search by exact cosine similarity

## Summary

The meaning half of hybrid search no longer asks Chroma's HNSW index for the nearest passages. The Langflow search
component (`langflow/components/rag_workspaces/chroma_search.py`) now caches each collection's vectors next to its BM25
index and scores every passage by cosine similarity, so a passage that is truly among the closest is never missed.
Collections too big to hold in memory still use Chroma's HNSW search.

## Why

HNSW is approximate. Even with the settings from [2026-11-23-hnsw-recall.md](2026-11-23-hnsw-recall.md)
(`ef_search` 400, `ef_construction` 200, `max_neighbors` 32), the live OUC tuning index (nomic embeddings with prefixes,
18,025 passages) left out passages that exact cosine ranks 1, 2, 3 and 5 for "What is a Skolem constant?": none of them
were in HNSW's top 200, so fusion (from [2026-11-23-hybrid-search.md](2026-11-23-hybrid-search.md)) could not use them and
the answer was a refusal. No HNSW setting the tuning thread tried was exact on all 8 test queries, while brute-force cosine
over all 18,025 vectors took 1.6 ms per query in numpy.

## Design

1. `_indexes` (was `_keyword_index`) reads the collection's count. If the cached entry has the same count and is under
   `INDEX_TTL_SECONDS` (120 s) old, it is reused.
2. Otherwise it reads every passage's text and metadata, as before (about 0.4 s for 18,000), and builds the `KeywordIndex`.
3. `_vector_index` then builds a `VectorIndex`: it reuses the previous index's vector for every id it already has and reads
   only the new ids' embeddings from Chroma (`POST …/get` with `ids`, 1,000 at a time). Reading all 18,000 vectors takes about
   3 s, so this keeps the two-minute refresh cheap. A passage id is `<document_id>:<chunk>` and chunks are not rewritten in
   place, so a held vector is still right.
4. `VectorIndex` holds the vectors as a normalised float32 numpy matrix plus each passage's folder. `search` is one
   matrix-vector product, an optional folder mask, `argpartition` for the top `limit`, then a sort.
5. `_vector_ranking` returns, per query vector, the 200 best ids from the `VectorIndex`, or from Chroma's `/query` when the
   collection is over `EXACT_MAX_VALUES` (64 million numbers, 256 MB; about 80,000 passages of 768 dimensions). Then fusion,
   multi-part interleaving and scoring continue unchanged.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Exact cosine in the Langflow worker | More HNSW tuning; a Chroma brute-force mode | No HNSW setting was exact on the test queries; Chroma 1.5 has no exact query. Brute force is milliseconds at this scale |
| Cache vectors next to the keyword index | Read vectors per query | Reading all vectors takes about 3 s; the keyword index already has the same lifetime and invalidation |
| Reuse held vectors by id on refresh | Read all vectors every refresh | Keeps the two-minute refresh at about 0.5 s instead of 3.5 s |
| Fall back to HNSW above 64M numbers | Always exact; a smaller cap | Bounds memory per collection in the worker; covers the expected workspaces several times over |
| Keep the HNSW settings from #80 | Drop them | The fallback path still uses them |

## Interfaces and contracts

- **HTTP API**: None. Same routes and response shapes; results can differ because the ranking is exact.
- **Configuration**: None. `EXACT_MAX_VALUES` is a constant in the component.
- **Data**: None. The vectors stay in Chroma; the cache is per Langflow worker and in memory.
- **Langflow**: the `Search` node's code in `flows/retrieve.json`, `flows/answer.json` and `flows/chat.json` is refreshed from
  the component. Same inputs, outputs and node ids.
- **Events and logs**: None.

## Operations

Restart Langflow to load the new component (it binds `./langflow/components` and `./flows`). No reindex needed. The first
search in a collection after a restart reads all its vectors once (about 3 s for 18,000 passages); later refreshes read only
new ones. Memory per cached collection is passages × dimensions × 4 bytes (about 55 MB for 18,000 × 768).

## Testing

- A one-off check against the smoke stack's Langflow container built an 18,000 × 768 collection with deliberately weak
  HNSW settings (`max_neighbors` 4, `ef_search` 10). Before the change, Chroma's search missed 61 of the exact top 10 over
  8 queries; after it, the component's ranking missed 0, at about 5 ms per query. A refresh with all vectors held took
  0.57 s. The same check confirmed the folder filter keeps only that folder and that, with a tiny `EXACT_MAX_VALUES`, the
  ranking is Chroma's own result.
- `apps/api/src/flows.test.ts` checks the flows' embedded code matches the component.
- `pnpm smoke` runs search, hybrid, folder and multi-part questions end to end through this path.

## Out of scope and follow-ups

- Sharing the cache between Langflow workers, or keeping it across restarts.
- An exact search for collections over the cap (for example, a vector store with exact search).

## Docs updated

`flows/README.md` (how search ranks by meaning, the cache) and `docs/architecture.md` (search recall).
