---
title: Record the response styles' results after the hardening
date: 2026-11-24
pr: pending
status: in review
areas: [docs]
---

# Record the response styles' results after the hardening

## Summary

`docs/tuning.md` gains a "Recheck after #127" section with a new run of the talkative and academic styles. Nothing in the code changes.

## Why

#127 tightened both styles after [style measurements](2026-11-23-style-measurements.md) found talkative answering uncovered questions
and academic citing while refusing. This measures whether it worked.

## Design

Documentation only. Same method and settings as the earlier run.

## Decisions and trade-offs

| Decision                                  | Alternatives considered | Why this one                                                  |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------- |
| Record the remaining failures, not a fix  | Change the wording again | Another wording change needs its own measurement and the owner |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

No code to test. Answers vary between runs.

## Out of scope and follow-ups

A structural fix: checking refusals after generation, or rejecting off-topic passages in search.

## Docs updated

`docs/tuning.md`.
