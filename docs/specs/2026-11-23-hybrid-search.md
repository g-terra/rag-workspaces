---
title: Search by words as well as meaning, fused with RRF
date: 2026-11-23
pr: pending
status: in review
areas: [flows, langflow, docs]
---

# Search by words as well as meaning, fused with RRF

## Summary

The `Search` component now runs two rankings and fuses them. Chroma's vector search gives the 200
passages closest in meaning. A BM25 keyword index over every passage's text and file name gives the 200
with the best word match. Reciprocal rank fusion (RRF, k = 60) combines the two, and the top `top_k` are
returned. `score` is still the cosine similarity of each returned passage, so `min_score` and everything that
reads `score` mean what they did. This covers search, answers and chat, since all three use the same
component.

## Why

The answer-quality tuning on Guilherme's Mac (2026-11-23) compared retrieval variants offline on the OUC
material: exact cosine, nomic v1.5, 800/100 chunks, 12 answerable questions plus 9 held out. The best variant
was hybrid BM25 (title plus text) fused with vectors by RRF (k = 60, top 200 each), with task prefixes. It
moved the original set from 9 to 10 correct at top 5 and from 10 to 11 at top 10, and the held-out set from
7 to 8 and from 7 to 9. Hybrid without prefixes was worse at top 5, so it pairs with the embedding-prefix PR.
Words find what similarity ranks low: rare exact terms such as a name, a symbol or a technical word that the
question shares with one passage.

## Design

All in `langflow/components/rag_workspaces/chroma_search.py`, embedded in `flows/retrieve.json`,
`flows/answer.json` and `flows/chat.json` (the drift test checks):

1. **By meaning:** Chroma `query` with the question's embedding, `n_results` = max(200, `top_k`), and
   the folder filter when set.
2. **By words:** `KeywordIndex`, Okapi BM25 (k1 1.5, b 0.75) over lower-cased word tokens of each passage's
   file name and text, with an inverted index. It is built from the collection with paged `get` calls and
   kept in a module-level cache per (Chroma URL, collection id). It is rebuilt when the collection's count
   changes or after 120 seconds. The folder filter is applied to its hits.
3. **Fusion:** `fuse()` gives each id 1 / (60 + rank) from each list and sorts by the total.
4. **Result:** the top `top_k` ids are read fresh from Chroma with their embeddings. Each gets its cosine
   score against the question, those below `min_score` are dropped, and ranks are numbered 1, 2, 3… in
   fused order. An id deleted since the index was built is skipped.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| BM25 in the Langflow search component | Postgres full-text search in the API; Chroma's `$contains` filter | Retrieval lives in the flows and the API only calls Langflow (decisions 18 and 20). The passage text is in Chroma, not Postgres. `$contains` filters and doesn't rank. |
| Hand-written BM25 | The `rank_bm25` package | It isn't in the Langflow image, and the scoring is about 20 lines. |
| In-memory index, rebuilt on count change or after 2 minutes | Rebuild on every search; a persistent index | A rebuild reads the whole collection, which is fine every few minutes but wasteful per question. A re-ingest that keeps the count can leave the keyword ranking up to 2 minutes old, but the final passages are always read fresh. |
| `score` stays cosine, `min_score` filters on it | Report the fused score | Clients, the admin UI and the refusal threshold read `score` as similarity. A fused score has no fixed scale. |
| RRF k = 60, 200 candidates each | Weighted score fusion | RRF needs no score normalisation, and these are the settings the tuning measured. |
| Always on | A setting to turn it off | The measurements favour it. A switch can come if a workspace needs one. |

Risk: a passage that only the keyword ranking finds and that has low cosine similarity is still cut by
`min_score`. With the default 0.3 that rarely happens for a passage that shares the question's rare words.

## Interfaces and contracts

- **HTTP API**: None in shape. Passage search, answers and chat return the fused order. `score` need not
  fall steadily down the list.
- **Configuration**: None.
- **Data**: None. No reindex is needed: the keyword index is built from the existing passages.
- **Langflow**: `ChromaWorkspaceSearch` code changes in three flows. Its inputs and outputs are unchanged.
- **Events and logs**: None.

## Operations

Restart Langflow (and the API, which re-imports the flows). The first search in each workspace builds its
keyword index, which reads every passage once.

## Testing

- `scripts/smoke/check.ts`, new step: ten notes share the query's heavily repeated common word, and one
  note shares only a rare word. Vector search ranks that note below all ten, so it is missing from the top
  8. It failed before the change and passes now.
- `apps/api/src/flows.test.ts`: the three flows carry the new code.
- All other smoke steps (search with folders, answers, transcripts) and the admin UI Playwright suite still
  pass. In one full e2e run, `usage.spec.ts` failed once and passed on rerun.

## Out of scope and follow-ups

- Splitting multi-part questions into separate searches: the next PR.
- Stemming or stop words in the keyword index. IDF already discounts common words.

## Docs updated

`flows/README.md` (the `rw-retrieve` output).
