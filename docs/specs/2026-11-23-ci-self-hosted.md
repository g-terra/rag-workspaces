---
title: run CI on the self-hosted runner
date: 2026-11-23
pr: "#69"
status: in review
areas: [ci, docs]
---

# Run CI on the self-hosted runner

## Summary

Every GitHub Actions workflow now runs on `runs-on: self-hosted` instead of `ubuntu-latest`. The CI job
starts its test Postgres with `docker run` instead of a job service, because job services only work on
Linux runners. The image build uses its own compose project name, so a dev stack on the same machine
is left alone. Job names don't change, so the required status checks stay the same.

## Why

On 2026-11-23 GitHub stopped starting hosted jobs on the account ("recent account payments have failed
or your spending limit needs to be increased"), so every check on #69 failed without running.
Guilherme registered a self-hosted runner ("moved to self hosted") and asked to "update the required
actions".

## Design

- `.github/workflows/*.yml`: `runs-on: self-hosted`, the label every self-hosted runner has, whatever
  its OS.
- `ci.yml`, `check` job:
  - "Start test Postgres" runs `postgres:16.16-alpine` as `rw-ci-pg-<run id>-<attempt>`, published on a
    free port on `127.0.0.1`.
  - It writes `TEST_DATABASE_URL` from `docker port` to `$GITHUB_ENV`, then waits for `pg_isready` over
    TCP. TCP is used because the init server answers on the socket before the real one is up.
  - "Stop test Postgres" removes the container even when a step failed.
- `ci.yml`, `docker` job: `docker compose --project-name rw-ci config/build`. The compose file names
  itself `rag-workspaces`, and building under that name would retag the dev stack's `api` and `web`
  images.
- Smoke and e2e already run as their own project `rag-workspaces-smoke`, on ports 13000, 18080 and
  18081 (`scripts/smoke/stack.ts`), so the dev stack's containers, volumes and ports aren't touched.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| The generic `self-hosted` label | A custom label such as `macOS` | It works with whatever runner was registered, without asking for its labels. Narrow it if a second runner appears |
| `docker run` Postgres on a random port | Keep `services:`; a fixed port like 55432 | `services:` fails on macOS and Windows runners. A random port can't collide with the dev stack or a parallel job |
| Leave smoke and e2e as they are | Give each run its own project name | Both already use a separate project and ports. A runner runs one job at a time, so they never overlap on one machine |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None for the app. CI needs a self-hosted runner with Docker, and Node available
  through `actions/setup-node`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None. The check names (Lint, typecheck, test, build; Compose config and images;
  Compose smoke test; Admin UI Playwright; Conventional Commit messages and title) are unchanged, so
  branch protection doesn't need updating.

## Operations

- With no runner online, jobs queue instead of failing.
- With two runners registered on one machine, smoke and e2e could start at the same time and clash on
  the `rag-workspaces-smoke` project. Keep one runner per machine, or give the runners distinct labels.
- The runner's machine needs enough free memory for the smoke stack (Langflow, Keycloak, Postgres,
  Chroma) next to any dev stack.

## Testing

This PR is its own test: its checks run on the self-hosted runner. Check that every job is green, and
that `docker ps` on the runner's machine shows no leftover `rw-ci-pg-*` container afterwards.

## Out of scope and follow-ups

- Going back to hosted runners once billing is fixed: change `runs-on` back. The Postgres step works
  there too.

## Docs updated

`AGENTS.md`: where CI runs, and what jobs must not assume.
