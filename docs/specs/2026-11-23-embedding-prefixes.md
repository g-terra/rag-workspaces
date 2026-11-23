---
title: Embed documents and queries with each model's task prefixes
date: 2026-11-23
pr: pending
status: in review
areas: [api, flows, langflow, docs]
---

# Embed documents and queries with each model's task prefixes

## Summary

Embedding models such as nomic-embed-text and Qwen3-Embedding were trained to see a task prefix before
the text: nomic expects `search_document: ` before passages and `search_query: ` before questions, and
Qwen3-Embedding expects an instruction before queries. We sent neither. Now each workspace pins the prefixes
for its embedding model, from a built-in table or `EMBEDDING_PREFIXES` in `.env`. The ingest flow puts
the document prefix before every chunk, and every search puts the query prefix before the question. A
workspace gets its prefixes when it is created or reindexed. Until then it embeds exactly as before.

## Why

The answer-quality tuning on Guilherme's Mac (2026-11-23) compared retrieval variants on the OUC material:
12 answerable questions plus 9 held out, nomic v1.5 and 800/100 chunks. Prefixes alone gave a modest
gain, and they are what lets the hybrid keyword search (the next PR) help at top 5. The samples are small,
so the gain is directional.

## Design

1. `embeddingPrefixes(model, config)` in `apps/api/src/services/providers.ts` returns
   `{ document, query }`. `EMBEDDING_PREFIXES` (JSON keyed by model id) wins. Otherwise a built-in table
   matches the model id: `nomic-embed-text` gives `search_document: ` / `search_query: `, and
   `qwen3-embedding` gives no document prefix and the query prefix
   `Instruct: Given a question, retrieve passages that answer the question\nQuery:`. Other models get none.
2. Pinning: `settings.embeddingPrefixes` is set with the embedding model when a workspace is created
   (`routes/workspaces.ts`) and on every reindex (`services/reindex.ts`), since a reindex re-embeds
   every document anyway. A workspace from before this change has no value and embeds without prefixes, so
   its stored vectors and its queries still match.
3. Tweaks: the ingest run (`services/ingest.ts`) and every search (`searchTweaks` in `services/passages.ts`,
   used by retrieve, answer and chat) send `document_prefix` and `query_prefix` to the `Embeddings` node,
   empty for none.
4. Langflow: `LMStudioEmbeddings` has two new advanced inputs. When either is set, it wraps the OpenAI
   client in `PrefixedEmbeddings`, which prefixes `embed_documents` and `embed_query`. The fields are added
   to the `Embeddings` node in all four flows (a new check in `flows.test.ts`).
5. The API returns `settings.embeddingPrefixes` read-only. `PATCH` refuses it, as it does the model.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Pin the prefixes on the workspace | Look them up on every run | A change to the table or `.env` would make queries differ from how the stored documents were embedded, silently weakening search until a reindex. Pinning keeps both sides the same, like the model itself. |
| Built-in table plus `EMBEDDING_PREFIXES` | Only `.env`, or a per-workspace editable setting | The common local models work with no setup. `.env` covers another model, or trying a different wording, without code. An editable setting would need a reindex on every edit, which reindex already gives. |
| Legacy workspaces embed without prefixes until reindexed | Apply prefixes at once | Mixing prefixed queries with unprefixed stored documents is exactly the mismatch pinning avoids. |
| Qwen3 instruction on queries only | Prefix documents too | That is how Qwen3-Embedding is meant to be used (documents plain, queries with an instruction). |

## Interfaces and contracts

- **HTTP API**: workspace `settings` gains read-only `embeddingPrefixes: { document, query } | null`.
  `PATCH` refuses it (the schema is strict).
- **Configuration**: `EMBEDDING_PREFIXES` (optional JSON object keyed by embedding model id, with
  `document` and `query` strings, each defaulting to ""). A value that is not such an object stops the API
  at startup. It is passed through `docker-compose.yml` and documented in `.env.example`.
- **Data**: `workspaces.settings` (jsonb) gains `embeddingPrefixes`. No migration: missing means none.
- **Langflow**: the `Embeddings` node in `rw-ingest`, `rw-retrieve`, `rw-answer` and `rw-chat` gains
  `document_prefix` and `query_prefix`. Node ids are unchanged.
- **Events and logs**: None.

## Operations

Restart the API and Langflow, then reindex each workspace that should use prefixes
(`POST /v1/workspaces/{slug}/reindex`, no body). The reindex pins the prefixes and re-embeds with them.
One reindex also picks up the new chunk boundaries (2026-11-23-structure-chunks.md) and HNSW settings
(2026-11-23-hnsw-recall.md).

## Testing

- `apps/api/src/services/providers.test.ts`: the nomic, Qwen3 and unknown-model prefixes,
  `EMBEDDING_PREFIXES` overrides, and a bad value refused.
- `apps/api/src/routes/workspaces.test.ts`: a new workspace pins the default model's prefixes.
- `apps/api/src/routes/reindex.test.ts`: switching to Qwen3 pins its prefixes, and a legacy workspace reads
  `null` until a reindex pins them.
- `apps/api/src/services/ingest.test.ts` and `routes/passages.test.ts`: the runs send the pinned prefixes,
  or empty ones for a legacy workspace.
- `apps/api/src/flows.test.ts`: every `Embeddings` node has the two fields and the current code.
- `scripts/smoke/check.ts`: with `EMBEDDING_PREFIXES` set for the stand-in's model, the workspace shows
  the prefixes, and the stand-in model receives `passage: …` for a document and `query: …` for a search
  (its `/_log` now records the start of each input, and the smoke stack publishes its port).

## Out of scope and follow-ups

- Hybrid keyword and vector search, and splitting multi-part questions: separate PRs.
- Showing the pinned prefixes in the admin UI's workspace settings.

## Docs updated

`docs/api-schema.md` (settings example and note), `flows/README.md` (Embeddings tweaks), `.env.example`.
