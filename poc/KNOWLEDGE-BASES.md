# Langflow knowledge bases against our Chroma search: results

Run on 2026-11-25. It follows the 2026-11-22 spike (`../spike/knowledge-bases/RESULTS.md`), which showed that Langflow 1.13.3's knowledge
bases can do the job but did not measure answer quality. The installed Langflow is the same 1.13.3, so the spike's findings still hold.
Code: branch `experiment/knowledge-bases` (commit 4a412d2, not for merge).

**Recommendation: keep Chroma with our search.** With 3 passages, the current setting, it answers more of the questions. The knowledge-base
version is smaller, but mostly because it does less.

## Method

A separate Langflow 1.13.3 and Chroma on port 17860, apart from the running install. The same 50 COS512 files went into both, with the same
splitter (1200/200), giving 4,560 passages each. Same chat model (`qwen3.6-35b-a3b-splash`, reasoning none, temperature 0.2), prompt and
minimum score (0.3). Each of the 15 questions was asked twice per setup; verdicts are Claude's reading, with Q5, Q10, Q12, Q13 and half of
Q7 expected to be refused (they are about other courses).

- **Current:** the flows on `main`: exact cosine plus BM25 fused by RRF, questions split into parts, nomic task prefixes.
- **Knowledge base:** Langflow's Knowledge component as it comes, SQLite backend, cosine. No prefixes, keyword search or splitting.

Flows were run directly in Langflow, not through our API.

## Answer quality (correct / partial / wrong of 15)

| | Current | Knowledge base |
|---|---|---|
| 3 passages, run 1 | 13 / 1 / 1 | 10 / 2 / 3 |
| 3 passages, run 2 | 14 / 0 / 1 | 10 / 2 / 3 |
| 8 passages, both runs | 14 / 0 / 1 | 14 / 0 / 1 |

Where they differ, with 3 passages:

| Question | Current | Knowledge base |
|---|---|---|
| Q1 epoch in the video | Correct | Wrong: refused, the passage was not found |
| Q6 Bellman-Ford and Floyd-Warshall | Partial, then correct | Wrong: no Week 9 (Floyd-Warshall) passage found |
| Q7 perceptron (and Hodgkin-Huxley) | Correct | Partial: no weighted sum and bias steps |
| Q11 "How does it work?" | Wrong: guesses a subject | Wrong: refuses instead of asking what is meant |
| Q12 another course's Nobel Prize | Correct (refused) | Partial: offers John Nash's 1994 prize as the answer |

Checked on retrieval only (cosine with prefixes, no keyword search or splitting, top 3): Q1 and Q6 each get the passages they lacked, which
points to the prefixes; Q7 does not, which points to keyword search and splitting.

## Code size (lines added / removed against `main`)

| Area | Added | Removed | Net |
|---|---|---|---|
| Langflow components | 124 | 578 | -454 |
| API and Langflow client source | 181 | 262 | -81 |
| Compose files | 0 | 21 | -21 |
| Component tests | 107 | 568 | -461 |

Components: 4 dropped (Chroma upsert, search, delete; LM Studio embeddings), 2 added (shape the passages and prompt context; delete one
document). 382 of the 578 removed lines are the search component, most of it the hybrid search and splitting that the knowledge base does
not have. Adding those back would undo much of the saving. The Chroma container goes; the flow JSON grows by 327 lines.

Not converted: 18 API test files do not compile on the branch, the smoke test still talks to Chroma, and the API does not yet set
Langflow's `OPENAI_COMPATIBLE_BASE_URL` variable. The final API figures would be a little larger.

## What each feature becomes

| Feature | With knowledge bases |
|---|---|
| Workspace isolation | Still one store per workspace, but all belong to one Langflow user; only our API keeps them apart |
| Hybrid search, question splitting | Lost |
| Embedding prefixes | Lost: the component embeds by itself and has no prefix setting |
| Folder filter | Kept, as a filter on the folder's document ids; moving a document no longer touches vectors (simpler). Filter checked live |
| Composites | Should work, since each source is searched on its own; not run |
| Delete one document | Needs our own component; checked live |
| Re-ingest | Unchanged chunks are skipped (39 were); changed files need a delete first, as now |
| Scores | Kept, as 1 - distance |
| Reading a passage by id | Lists the document's chunks instead; the 3,861-chunk book takes up to 39 requests |
| Hosted embeddings, saved workspace keys | Through Langflow's own providers and model list; not tested |

The routes we would call are undocumented in Langflow and could change in an upgrade.

## Limits

- 15 questions, partly used to tune the current search, and a model that does not answer identically twice. The 3-passage gap (Q1, Q6, Q7,
  Q12) is the signal; small differences are noise.
- It compares two search methods, not Chroma with SQLite. Prefixes were not tested separately through full answers.
- Latency is not reported: the current setup always ran first, so the order is not neutral.
- Review of the branch found open problems before any real use: a reindex that fails after the delete leaves no store, deleting from a
  missing store is an error, and a slug reused after a failed delete can keep the old vectors.
