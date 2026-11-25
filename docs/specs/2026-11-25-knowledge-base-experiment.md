---
title: try Langflow knowledge bases in place of Chroma
date: 2026-11-25
pr: "none (experiment branch, not for merge)"
status: proposed
areas: [flows, api, infra]
---

# Try Langflow knowledge bases in place of Chroma

## Summary

Experiment branch `experiment/knowledge-bases`, not for merge. It replaces the three Chroma components with
Langflow 1.13.3's Knowledge component on the SQLite backend, to compare answer quality and code size.

## Why

Guilherme asked on 2026-11-25 whether native knowledge bases give better results and simpler code. The spike
(`spike/knowledge-bases/RESULTS.md`, PR #31) found them feasible before hybrid search, prefixes and
composites existed; it did not measure quality on real material.

## Design

1. Ingest: Loader → WorkspaceTextSplitter (now numbering chunks) → Knowledge (Ingest).
2. Retrieve, answer, chat: Knowledge (Retrieve) → `KnowledgePassages`, which applies `min_score`, shapes the
   passages and builds the numbered context.
3. Delete: `KnowledgeDocumentDelete` over the backend's `delete_by` (from the spike).
4. API: knowledge bases created and deleted over Langflow's REST routes; a folder search filters on the ids of
   the folder's documents, so moving a document touches no vectors.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Native retrieval only, no BM25 or prefixes | Reimplement both on the backend | The question is what Langflow gives us without our search code |
| SQLite backend, cosine metric | Postgres + pgvector | Stock image, exact filter (spike F1, F5) |
| Own Langflow and Chroma on port 17860 for both arms | Use the running install | Leaves its data and workspaces alone; same image, files and models for both arms |

## Interfaces and contracts

- **HTTP API**: None in shape. Multi-part and keyword search are gone.
- **Configuration**: `CHROMA_URL` goes.
- **Data**: vectors move from Chroma to SQLite files in Langflow's volume.
- **Langflow**: nodes `Embeddings`, `Upsert`, `Search` become `Knowledge` and `Passages`.
- **Events and logs**: None.

## Operations

None: not deployed.

## Testing

`langflow/tests/test_knowledge_*.py`, the flow tests, and the A/B run described in Results.

## Out of scope and follow-ups

Migration, merging.

## Docs updated

None: the branch is not for merge.
