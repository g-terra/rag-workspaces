---
title: Record how the response styles answer the test questions
date: 2026-11-23
pr: "#126"
status: in review
areas: [docs]
---

# Record how the response styles answer the test questions

## Summary

`docs/tuning.md` gains a "Response styles" section with one measured run per built-in style. Nothing in the code changes.

## Why

The styles ship with grounding rules repeated after the header ([response styles](../tuning.md)), but had not been measured
against real answers: citations, refusals, vague and partly covered questions.

## Design

Documentation only. Each style was passed as `style` on `POST /v1/workspaces/ouc-tuning/answers`, and every answer was read
against the expected one.

## Decisions and trade-offs

| Decision                                      | Alternatives considered       | Why this one                                                              |
| --------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Report findings, don't change the styles here | Edit talkative's instructions | A prompt change needs its own measurement and the owner's choice          |
| Numbers from one run, with repeats where noted | Several runs per style       | Enough to show a pattern; the text says small differences are noise       |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

No code to test. The run is repeatable with any workspace that has the OUC material; answers vary between runs.

## Out of scope and follow-ups

- Making talkative refuse uncovered questions, and academic refuse without citing unrelated passages.
- Asking back on vague questions.

## Docs updated

`docs/tuning.md`.
