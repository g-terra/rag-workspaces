---
title: remove citations to passages the model was not given
date: 2026-11-24
pr: pending
status: proposed
areas: [api, flows, docs]
---

# Remove citations to passages the model was not given

## Summary

A reply no longer cites passage numbers that don't exist. The prompt says which numbers are valid and
writes transcript times as `(4:00)` instead of `[4:00]`. If the model still invents a number, the API
removes it before storing and returning the reply.

## Why

With `topK` 3 and Qwen 3.6 35B, "What is an epoch in machine learning?" cited `[4]`. Three passages were
sent, and LM Studio's log shows the model wrote `[4]` itself; the statement came from passage 3. The
first passage starts with the time `[4:00]`. Rebuilding the same prompt (the same 1,006 tokens) gave `[4]` in
10 of 10 runs; with `(4:00)`, `[3]` in 10 of 10. With the times removed it wrote `[14]` in 7 of 10, probably
from "slide 14"; adding the line of valid numbers gave `[3]` in 10 of 10. This is one question on one model.
Builds on [2026-11-24-refusal-grounded.md](2026-11-24-refusal-grounded.md).

## Design

- `langflow/components/rag_workspaces/chroma_search.py` (`get_context`, copied into `flows/answer.json`,
  `chat.json` and `retrieve.json`) and `contextText` in `apps/api/src/services/composite-search.ts` start
  the context with "The passages are numbered 1 to n. Cite only these numbers." and rewrite `[m:ss]` and
  `[h:mm:ss]` with round brackets.
- `apps/api/src/services/citations.ts`: `dropUnknownCitations(text, ranks)` removes a single `[n]` or
  `【n】` whose number is not in `ranks`, with the space before it. `generate.ts` applies it before
  computing `grounded`, for answers and chat, plain and composite.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Remove the number | Guess the passage it meant | A wrong guess looks like evidence. A sentence may end up with no citation. |
| Leave lists (`[0, 1]`), numbers of three digits or more, code, indexes and links alone | Remove every unknown number | Course material is full of intervals, years and array indexes. An invented number in a list stays as plain text. |
| Rewrite times only in the prompt | Change stored transcripts | No reindex, and passages still show the original text. |

## Interfaces and contracts

- **HTTP API**: `text` of answers and messages may lack numbers the model wrote. No shape changes.
- **Configuration**: None.
- **Data**: None. Stored answers are not changed.
- **Langflow**: the Search node's `context` output starts with the line of valid numbers.
- **Events and logs**: streamed `token` events carry the model's text as written; `done` has the cleaned text.

## Operations

Restart Langflow so it imports the flows, and rebuild the API. Nothing to migrate.

## Testing

`apps/api/src/services/citations.test.ts` (what is removed and what is kept),
`composite-search.test.ts`, `routes/answers.test.ts` and `routes/composite-answers.test.ts`.
`flows.test.ts` checks the flows carry the component's code. A `scripts/smoke/check.ts` step checks the
prompt the model receives; the stand-in (`poc/standin/server.ts`) now logs the whole prompt.

## Out of scope and follow-ups

- A citation to a real passage that doesn't support the sentence.
- Removing an invalid number from streamed tokens before the reply ends.

## Docs updated

`docs/api.md`, `flows/README.md`.
