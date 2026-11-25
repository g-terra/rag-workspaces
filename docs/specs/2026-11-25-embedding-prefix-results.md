---
title: record the nomic prefix measurement
date: 2026-11-25
pr: "#134"
status: in review
areas: [docs]
---

# Record the nomic prefix measurement

## Summary

Adds `poc/embedding-prefixes/`: the with/without measurement of nomic-embed-text-v1.5's task prefixes on the
COS512 material, so the report can cite it. No behaviour changes.

## Why

`2026-11-23-embedding-prefixes.md` added the prefixes on the model card's word, which gives no numbers. The
owner asked whether they could be removed.

## Design

`poc/embedding-prefixes/README.md` holds the results, method and caveats; `questions.md` the 146 generated
questions with each one's source and rank.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Measure offline, outside the app | A second workspace without prefixes | Needs no key or configuration change; prompts matched the app's token counts on all 15 questions |
| Keep the prefixes | Remove them | 10 questions gained a top-3 hit and 2 lost one; the custom component is needed either way |
| Leave out passage texts and generated answers | Commit them | Course texts belong to OUC and their authors |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

Documentation only. The figures come from the runs described in `poc/embedding-prefixes/README.md`.

## Out of scope and follow-ups

Testing Langflow's "Embedding Model" node against LM Studio; a non-generated question set.

## Docs updated

`poc/embedding-prefixes/`. None of the long-lived docs: the prefixes stay as they are.
