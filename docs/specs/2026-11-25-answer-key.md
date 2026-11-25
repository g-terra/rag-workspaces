---
title: compare the tool and Codex on 20 questions with known answers
date: 2026-11-25
pr: "#137"
status: in review
areas: [docs]
---

# Compare the tool and Codex on 20 questions with known answers

## Summary

Adds `poc/answer-key/README.md`: 20 questions with expected answers and citations, what the local install and Codex answered, and how long
each took. Docs only.

## Why

Guilherme asked for it on 2026-11-25, for the course report.

## Design

One results page: summary, method, limits, key, verdicts with times, answers.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Key written before either system ran | Grade by agreement | The expected answer does not depend on either system |
| Codex on `gpt-5.6-luna`, low effort | A larger model | The owner asked for a cheaper model |
| Quotes of at most a few words | Passage texts | The repo is public and the material is course content |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

The page is generated from the saved runs; `pnpm format:check` passes.

## Out of scope and follow-ups

Raising the workspace's passage count from 3.

## Docs updated

`poc/answer-key/README.md` (new), linked from `poc/README.md`.
