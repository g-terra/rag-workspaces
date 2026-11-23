---
title: Search each part of a multi-part question
date: 2026-11-23
pr: "#85"
status: merged
areas: [flows, langflow, docs]
---

# Search each part of a multi-part question

## Summary

A question that asks two or more things ("Which learning rate schedules work, and how does the perceptron
update its weights?") is now searched part by part. The search component splits the question into its
parts, runs the hybrid search (meaning plus words, fused) for each part, and lets the parts take turns
filling the `top_k` results. A part with few words therefore gets its passages in instead of being
outweighed by a longer part. A question that asks one thing is searched as before.

## Why

The answer-quality tuning on Guilherme's Mac (2026-11-23) found that question 7 of the evaluation, which
asks about two unrelated topics, had the perceptron evidence in no top 20. One embedding and one keyword
query for the whole question lean towards the part with more words. The tuning asked for multi-part query
splitting.

## Design

In `langflow/components/rag_workspaces/chroma_search.py` (embedded in `flows/retrieve.json`,
`flows/answer.json` and `flows/chat.json`):

1. `question_parts(query)` reads the last line of the query only. A chat search puts the previous question
   on the line before it as context, and that line should not become a part. It splits at question marks
   ("What is X? How does Y work?") and at "and" followed by a question word or an instruction
   ("…, and how does…", "Define X and explain Y"). It returns at most 4 parts of at least two words each,
   or none when the question asks one thing. "Compare forward and backward chaining" and "the difference
   between A* and greedy search" are not split.
2. `_search` runs one Chroma query with an embedding per part (one request), and one BM25 search per part.
   Each part's two rankings are fused with RRF on their own.
3. `interleave()` takes the first passage of each part's ranking, then the second of each, and so on,
   skipping duplicates, up to `top_k`.
4. `score` is the cosine similarity against the whole question, embedded once more, so scores and
   `min_score` mean the same with or without parts.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Split with rules on the question's own words | Ask the chat model to split the question | No extra model call (seconds with a local model) before every search, deterministic, and it works for search without a chat model. The rules miss parts joined without "and" or a question mark. |
| Parts take turns | Fuse every part's rankings into one RRF list | Tried first. In a small collection every passage is in every vector list, so passages that were middling for every part (sharing words like "the") beat the best passage of each part. Turns give each part its share. |
| Search the parts instead of the whole question as well | Add the whole question as one more ranking | The whole question leans to the longer part, the bias this fixes. |
| Only the last line is split | Split the whole chat search query | The line before is the previous question, kept as context for follow-ups. Searching it as its own part would bring back passages for the question already answered. |
| Scores against the whole question | Scores against the part that found the passage | Keeps `score` comparable between questions and the threshold meaning one thing. |

Risk: in a multi-part question, the best passages for the first part now share `top_k` with the other
parts. With the default `top_k` of 5 and two parts, a part gets 2 or 3. A passage of a part with low
similarity to the whole question can be cut by `min_score`.

## Interfaces and contracts

- **HTTP API**: None in shape. Searches, answers and chat replies for multi-part questions return a mix
  of each part's passages.
- **Configuration**: None.
- **Data**: None. No reindex needed.
- **Langflow**: `ChromaWorkspaceSearch` code changes in three flows. Inputs and outputs are unchanged.
- **Events and logs**: None.

## Operations

Restart Langflow and the API.

## Testing

- `scripts/smoke/check.ts`, new step: ten notes match the first part's many words, and one note answers
  the second part. Searched as one query, the note was missing from the top 5. It also failed when all
  parts' rankings were fused into one list. It passes with turns.
- The splitting rules were checked by hand in Langflow's Python: one question is not split; "X, and how
  does Y" and "X? Y?" are split; "Compare A and B" and "difference between A and B" are not; a chat query
  with a previous line splits only its last line.
- `apps/api/src/flows.test.ts`: the three flows carry the new code.

## Out of scope and follow-ups

- Splitting by the chat model, for questions the rules miss.
- Stop words in the keyword index.

## Docs updated

`flows/README.md` (the `rw-retrieve` output).
