---
title: record the knowledge base experiment
date: 2026-11-25
pr: "#136"
status: in review
areas: [docs]
---

# Record the knowledge base experiment

## Summary

Adds `poc/KNOWLEDGE-BASES.md`: answer quality and code size of Langflow 1.13.3 knowledge bases against our Chroma search. Docs only.

## Why

Guilherme asked for the trial, and for its results in `poc/` so the course report can refer to them.

## Design

One results page; the code stays on the `experiment/knowledge-bases` branch.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Results only on `main` | Merge the experiment code | The recommendation is to keep Chroma (decision 20 stands) |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

Numbers come from the saved run and `git diff --numstat`. `pnpm format:check` passes.

## Out of scope and follow-ups

Porting the branch's API tests and smoke checks.

## Docs updated

`poc/KNOWLEDGE-BASES.md` (new), linked from `poc/README.md`.
