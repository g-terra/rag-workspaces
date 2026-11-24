---
title: remove citations to passages the model was not given
date: 2026-11-24
pr: pending
status: proposed
areas: [api, flows, docs]
---

# Remove citations to passages the model was not given

## Summary

The prompt now says which passage numbers are valid and writes times as `(4:00)` instead of `[4:00]`, so the
model rarely invents a citation. If it still ends a statement with a number that has no citation, the API
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
- `apps/api/src/services/citations.ts`: `dropUnknownCitations(text, ranks)` removes `[n]` or `【n】` with no
  citation in `ranks`, only where a statement ends: after a word and before punctuation or the end of the line, or
  after a full stop at the end of the line. Code, math and table rows are skipped. `generate.ts` applies it before computing
  `grounded`, for answers and chat, plain and composite.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Remove the number | Guess the passage it meant | A wrong guess looks like evidence. A sentence may end up with no citation. |
| Remove only where a statement ends; in doubt keep the text | Remove every unknown number (the first version) | Two reviews found text the wider rules cut: formulas, values, code, list numbers, reference lists. Losing a fact is worse than a leftover number. So an invented number stays mid-sentence, after a digit, sign, bracket, label, comma or code, alone on a line, without a space before it, or in a list. |
| Skip "see [4]", "returns [5]" and similar | Parse the Markdown | A short word list covers the usual cases. A value or a reference after any other word, at the end of a sentence, can still be taken for a citation. |
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

- Old numbers in a conversation's earlier replies, which the model sees as history.
- A passage whose document stops being ready mid-answer has no citation, so its number is removed too.
- A citation to a real passage that doesn't support the sentence.
- Removing an invalid number from streamed tokens before the reply ends.

## Docs updated

`docs/api.md`, `flows/README.md`.
