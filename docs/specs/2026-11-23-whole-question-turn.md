---
title: search the whole question too when it has several parts
date: 2026-11-23
pr: "#91"
status: in review
areas: [flows, langflow, docs]
---

# Search the whole question too when it has several parts

## Summary

A question with several parts is still searched part by part, but the whole question now takes a turn after the parts when
the results are filled. A later part that names no subject of its own ("…, and how many targets are there in most
versions?") no longer loses the passage that answers it. The interleaving also changes: each ranking now adds its best passage
not taken yet, instead of skipping its turn when its next passage was already taken.

## Why

[2026-11-23-multi-part-questions.md](2026-11-23-multi-part-questions.md) splits "How does the Mackworth clock test measure
vigilance, and how many targets are there in most versions?" into two parts. The second part leans on the first for its
subject, so searched alone it found passages about targets in general, and the answer missed the count (12). The tuning
thread suggested searching the unsplit question as well.

## Design

In `langflow/components/rag_workspaces/chroma_search.py`, `_search`:

1. `question_parts` splits the query as before. When there are parts, the queries are the parts followed by the whole
   question; otherwise just the question.
2. Each query is ranked by meaning and by words and fused on its own (RRF), as before.
3. `interleave` takes turns across those rankings in order: every turn, each ranking adds its best passage that is not taken
   yet. The whole question comes last, so the parts keep their priority.
4. Scores are cosine against the whole question, which is now the last embedding, so one embedding call fewer than before.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Whole question as one more turn | Prefix each later part with the first part; fuse every part with the whole question | Keeps each part's own ranking intact; the whole question carries the subject without making every part lean to the longer part |
| Whole question last | First | The parts still fill the first slots, which is what splitting is for |
| Next untaken id per turn | Skip a turn when the next id is taken (before) | A ranking whose top passage another part already took would otherwise give up its slot |

## Interfaces and contracts

- **HTTP API**: None. Same routes and shapes; multi-part results can differ.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: the `Search` node's code in `flows/retrieve.json`, `flows/answer.json` and `flows/chat.json` is refreshed from
  the component. Same inputs, outputs and node ids.
- **Events and logs**: None.

## Operations

Restart Langflow to load it. No reindex.

## Testing

- New smoke step in `scripts/smoke/check.ts`, "a part with no subject of its own still finds the passage that answers it":
  three vigilance notes, three sales notes that share most of the second part's words, and one passage that answers it. It
  failed before the change (top 4: two vigilance notes and two sales notes) and passes after.
- The earlier step "a question about two topics searches each part" still passes.
- `apps/api/src/flows.test.ts` checks the flows' code matches the component.

## Out of scope and follow-ups

- Rewriting a subject-less part with the subject (for example, by the chat model) before searching.

## Docs updated

`flows/README.md`: the whole question's turn.
