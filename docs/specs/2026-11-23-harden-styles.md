---
title: keep the talkative and academic styles to the passages
date: 2026-11-23
pr: pending
status: in review
areas: [api, docs]
---

# Keep the talkative and academic styles to the passages

## Summary

The built-in `talkative` and `academic` styles get a sentence each about what to do when the passages
don't cover the question: say so in one sentence and cite nothing. Talkative's "explain in more depth"
is now limited to the passages, and its related-question suggestion is only allowed after a supported
answer. The style header's grounding recap also adds "and cite nothing".

## Why

The real-model check per style (Qwen 3.6 35B in LM Studio, the `ouc` workspace's 15 questions, results
in `docs/tuning.md`) found two problems:

- **Talkative** answered an off-topic question ("How do I configure a Kubernetes ingress?") from general
  knowledge instead of refusing, and 2 of 3 repeats opened the same way. Its text asked for more depth
  and a closing suggestion, which pulled against the refusal rule.
- **Academic** refused but sometimes cited unrelated passages next to the refusal. A reply counts as
  `grounded` when it cites any passage it was given (`citesAny` in `apps/api/src/services/generate.ts`),
  so those refusals came back with `grounded: true`.

Decision 24 says a style changes only tone, length and format, and never weakens citations or refusals.
This builds on [2026-11-23-response-styles.md](2026-11-23-response-styles.md).

## Design

All in `apps/api/src/services/styles.ts`:

- `academic`: "Cite a passage only where it directly supports the sentence; a passage on another topic is
  never a source. If the passages do not cover the question, say so in one formal sentence and cite
  nothing."
- `talkative`: "Explain in more depth than usual, but only from the passages … add nothing from general
  knowledge." "If the passages do not cover the question, say so in one friendly sentence and stop: no
  explanation, no citations." The suggestion is allowed "only after an answer the passages support".
- `composeSystemPrompt`: the recap after the built-in prompt now ends "say only that, and cite nothing",
  the same words as the base prompt's refusal rule. Every style gets this.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Fix the prompts, leave the `grounded` check as it is | Detect refusal wording in the reply and force `grounded: false` | Refusal wording varies by language and model, so a phrase match would misfire on real answers. Citing nothing is already the rule, so a refusal that obeys it is ungrounded. If the rerun still shows cited refusals, a check can follow with evidence. |
| Put the refusal sentence in each style's own text | Only strengthen the shared recap | Small local models weigh the last lines most, and the style text comes last. The shared recap is strengthened too. |
| Keep talkative's closing suggestion | Drop it | It is part of what makes the style talkative. Limiting it to supported answers removes the case that went wrong. |

## Interfaces and contracts

- **HTTP API**: none changed. `GET /v1/styles` returns the new instructions for the two built-ins.
- **Configuration**: None.
- **Data**: None. Stored answers keep their text and their style slug.
- **Langflow**: None. The composed prompt still goes in the `LLM` node's `system_message` tweak.
- **Events and logs**: None.

## Operations

Nothing to do. The new text applies to answers asked after the API restarts. Custom styles are
unchanged, but they get the stronger recap.

## Testing

`apps/api/src/services/styles.test.ts` checks that the recap tells the model to cite nothing, that
talkative stays with the passages and offers its suggestion only after a supported answer, and that
academic cites only passages that support the sentence and cites nothing in a refusal. These checks
pin the text but can't prove model behaviour. The proof is rerunning the per-style check on the Mac:
ask each of the two styles the off-topic Kubernetes question three times and the 15 tuning questions
once, then compare with `docs/tuning.md`.

## Out of scope and follow-ups

- A `grounded` check that ignores citations inside a refusal, if the rerun still finds cited refusals.
- The concise (2 partial) and tutor (12 of 15) scores, which the check didn't flag as grounding
  problems.

## Docs updated

`docs/api-schema.md` (the style header recap now says citing nothing). The rerun's results go in
`docs/tuning.md` through the tuning thread.
