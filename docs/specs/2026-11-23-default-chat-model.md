---
title: default to gpt-oss-20b as the chat model
date: 2026-11-23
pr: "#96"
status: merged
areas: [api, infra, docs]
---

# Default to gpt-oss-20b as the chat model

## Summary

A new install now uses `openai/gpt-oss-20b` in LM Studio as the chat model, instead of `qwen2.5-7b-instruct`. The setup
wizard suggests it, `.env.example` and compose carry it, and the setup guide tells you to download and load it.

## Why

Guilherme picked it from the tuning results ([docs/tuning.md](../tuning.md)). It is the lighter of the two models tuned
on the OUC material (about 12 GB against 21 GB for `qwen3.6-35b-a3b`) and scored 12 of 15 against 13 in one run each, so
it fits more machines for a small loss.

## Design

- `apps/api/src/config.ts`: `DEFAULT_CHAT_MODEL` defaults to `openai/gpt-oss-20b`.
- `docker-compose.yml` and `.env.example`: the same default.
- `scripts/setup.ts`: the LM Studio chat suggestion in the wizard.
- `docs/setup.md`: the model to download and the `lms load` command, plus a pointer to the heavier option.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| gpt-oss-20b | qwen3.6-35b-a3b with reasoning none; keep qwen2.5-7b | Guilherme's choice on a decision card: fits more machines, close in score |
| Leave `DEFAULT_REASONING_EFFORT` empty | Default it to "none" | The tuning thread found "none" doesn't turn gpt-oss reasoning off, and hosted models may reject it |

## Interfaces and contracts

- **HTTP API**: `GET /v1/system` reports the new default chat model.
- **Configuration**: default of `DEFAULT_CHAT_MODEL` is `openai/gpt-oss-20b`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

An install with `DEFAULT_CHAT_MODEL` set in `.env` keeps its model. One without it switches to gpt-oss-20b, which must be
downloaded and loaded in LM Studio (`lms load openai/gpt-oss-20b`). Workspaces with their own chat model are unaffected.

## Testing

`apps/api/src/config.test.ts` checks the default provider and model (failed before the change). `pnpm test:scripts` covers
the wizard.

## Out of scope and follow-ups

None.

## Docs updated

`docs/setup.md`, `docs/tuning.md` and `docs/api-schema.md` (examples).
