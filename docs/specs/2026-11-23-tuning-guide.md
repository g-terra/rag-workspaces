---
title: add the answer quality tuning guide
date: 2026-11-23
pr: pending
status: in review
areas: [docs]
---

# Add the answer quality tuning guide

## Summary

Adds `docs/tuning.md`, written from the tuning work on the `ouc` workspace: how to measure retrieval and answers, the
recommended settings for local models on the OUC material, and what was learned. The README links it.

## Why

The tuning on the user's Mac (this evening, with #78 to #91) moved the 15-question set from 10 correct, 1 partial and 4 wrong
to 12 correct, 2 partial and 1 wrong. The method, settings and lessons should outlive the session that found them, and
feed the report.

## Design

One new page, `docs/tuning.md`, with three sections: Method, Recommended settings, Lessons. The text is the tuning thread's
draft, with the question number in "known misses" spelled out so it reads without the question set.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A page of its own | A section in `docs/setup.md` | Setup is about getting running; tuning is a later, separate task |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None. The page recommends values for existing settings.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

Docs only: `pnpm format:check`.

## Out of scope and follow-ups

- Committing the question sets themselves.
- Fixing the known misses (vague questions answered; the Mackworth target count).

## Docs updated

`docs/tuning.md` (new) and `README.md` (link).
