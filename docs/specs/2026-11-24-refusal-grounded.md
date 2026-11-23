---
title: count a refusal that cites passages as not grounded
date: 2026-11-24
pr: pending
status: in review
areas: [api, docs]
---

# Count a refusal that cites passages as not grounded

## Summary

A model reply that opens by saying the material does not cover the question, and is at most three
sentences long, is now `grounded: false`, even if it cites passages. Before this, any citation of a
passage the model was given made a reply grounded. The text and the passages it read are kept, as for
any ungrounded reply.

## Why

The per-style check on Qwen 3.6 35B (`docs/tuning.md`, "Recheck after #127") found the academic and
talkative styles refusing correctly but citing passages while doing so: academic in 5 of 6 repeats of
the off-topic questions. Every such refusal came back `grounded: true`. That flag drives the usage
page's ungrounded count and tells agents whether to trust an answer. #127 already asked the styles to
cite nothing in a refusal, and the rerun showed that wording alone doesn't stop it. Follows
[2026-11-23-harden-styles.md](2026-11-23-harden-styles.md).

## Design

- `apps/api/src/services/refusal.ts`: `isRefusal(text)` splits the reply into sentences. It returns
  true when there are at most three, and the first one (or the second, after a short opener with no
  citation such as "Great question!") says the material does not cover it. Citation markers are removed
  first. It recognises three kinds of wording: a source word with a negation and a covering verb ("the
  passages do not address…", "the documents contain no information…"); "not covered", "not mentioned"
  and similar; and "couldn't find anything", which is also the API's own `NOT_FOUND_TEXT`.
- `apps/api/src/services/generate.ts`: `grounded` is `!isRefusal(text) && citesAny(text, ranks)`, for
  answers and chat replies, streamed or not.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Check the reply after generation | Make search reject off-topic passages; more prompt wording | Wording didn't work (#127 rerun). Rejecting passages needs a relevance model or a tuned threshold, and the tuning notes say scores of unanswerable questions sit too close to answerable ones. |
| Keep the text and the passages, change only `grounded` | Remove the `[n]` markers or the citations | Streamed replies have already sent their text, and every other ungrounded reply keeps the passages it read. One rule is easier to rely on. |
| The refusal must come first, in at most three sentences | Any sentence anywhere | A partial answer ends with "the material does not cover X" after real content, and it must stay grounded. A long answer that opens with what is missing is an answer too. |
| English patterns only | A model call to classify the reply | The prompts ask for English wording, and a model call would add latency and cost to every answer. A reply in another language falls back to the citation rule, which is no worse than before. |

## Interfaces and contracts

- **HTTP API**: `grounded` on answers and conversation messages can now be `false` for a reply that
  cites passages. No shape changes.
- **Configuration**: None.
- **Data**: None. Stored answers keep the value they were saved with.
- **Langflow**: None.
- **Events and logs**: The streamed `done` event and usage's ungrounded count follow the new rule.

## Operations

Nothing to do. The rule applies to answers asked after the API restarts. Earlier answers aren't
recomputed.

## Testing

`apps/api/src/services/refusal.test.ts` covers refusals with `[n]` and `【n】` citations, a friendly
opener, a two-sentence refusal, and the fixed not-found text. It also checks what must stay an answer: a
cited answer, a partial answer ending with what is missing, a long answer that opens with what is
missing, and a question back to the user. `apps/api/src/routes/answers.test.ts` checks a cited refusal
end to end: `grounded: false`, with the text and the passages kept. By hand, rerun the Kubernetes and
World Cup questions in the academic style (see `docs/tuning.md`) and check `grounded`.

## Out of scope and follow-ups

- Talkative sometimes answering an off-topic question from the passages (1 of 3 repeats). That reply
  isn't a refusal, so this check doesn't touch it. A search that rejects off-topic passages would.
- Refusal wording in other languages.

## Docs updated

`docs/api-schema.md` and `docs/api.md` (when a reply is `grounded: false`).
