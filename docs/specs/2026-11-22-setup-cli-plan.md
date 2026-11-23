---
title: Plan a guided setup CLI (pnpm setup)
date: 2026-11-22
pr: "#32"
status: merged
areas: [docs]
---

# Plan a guided setup CLI (pnpm setup)

## Summary

The work breakdown gains backend item 14: `pnpm setup`, an interactive wizard that takes a fresh clone
to a running stack. It checks the machine, writes `.env`, helps pick the model provider and models,
starts compose and prints where to log in. This PR only adds it to the plan; nothing is built yet.

## Why

The owner asked for it on 2026-11-22 while testing the stack locally. Setup today is several manual
steps, and each of these went wrong at least once during review:

- `pnpm env:init`;
- editing `.env` for LM Studio model ids;
- freeing port 7860 from another Langflow;
- `docker compose up`;
- finding the admin login.

A marker installing the project for the assignment (M7) hits the same steps.

## Design

Planned behaviour, recorded in `docs/work-breakdown.md` (Workstream 1, item 14; M7 row):

1. Check Node, pnpm and Docker versions.
2. Check the published ports are free, naming the process that holds one.
3. Write `.env` with fresh secrets. This takes over from `pnpm env:init`, and existing secrets are kept.
4. Ask for the model provider:
   - For LM Studio, check `/v1/models` and pick the embedding and chat models from the ones loaded.
   - Otherwise, ask for an OpenAI, Gemini or Anthropic key.
5. Start `docker compose`, wait for `/ready`, and print the admin UI, Swagger and Keycloak URLs with the
   admin login.
6. Optionally create the first workspace.

Two options round it out:

- `--yes` takes the defaults, for scripts and CI.
- The checks are shared with the planned `pnpm doctor`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| A Node script in `scripts/`, run by `pnpm setup` | A shell script; a separate npm package | Same language and runtime as the repo; works on macOS (zsh) and Linux; no new install step |
| Planned for M7 | Build it now | Rule 1: nothing before it's needed. It depends on settings and `/ready` that the open stack is still adding |
| Re-runnable, keeps existing secrets | Fail if `.env` exists (today's `env:init`) | A second run fixes a broken setup instead of refusing |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None yet. When built, it writes the existing `.env` variables, including `DEFAULT_EMBEDDING_MODEL`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. This changes the plan only.

## Testing

Documentation only. `pnpm format:check` passes.

## Out of scope and follow-ups

Building the wizard, in its own PR with its own spec, once the review stack (#16 to #30) is merged.

## Docs updated

`docs/work-breakdown.md`: Workstream 1 item 14 and the M7 row.
