---
title: run CI on the self-hosted runners
date: 2026-11-23
pr: "#69"
status: in review
areas: [ci, docs]
---

# Run CI on the self-hosted runners

## Summary

GitHub Actions now runs on Guilherme's own runners (four on his Mac) instead of `ubuntu-latest`. The
light jobs use the `rw-light` label, which any of the four can take, so they run in parallel. Smoke and
e2e use `self-hosted`, which only runner 1 has, so only one smoke stack runs at a time. The CI job
starts its test Postgres with `docker run` instead of a job service, because job services only work on
Linux runners. The image build uses its own compose project name, so a dev stack on the same machine
is left alone. Job names don't change, so the required status checks stay the same.

## Why

On 2026-11-23 GitHub stopped starting hosted jobs on the account ("recent account payments have failed
or your spending limit needs to be increased"), so every check on #69 failed without running.
Guilherme registered self-hosted runners ("moved to self hosted") and asked to "update the required
actions". Runners 2 to 4 carry only `rw-light`; runner 1 carries `rw-light` and `self-hosted`.

## Design

- `ci.yml` (both jobs), `commits.yml`, `pr-title.yml`, `release.yml` (both jobs): `runs-on: rw-light`.
- `smoke.yml`, `e2e.yml`: `runs-on: self-hosted`, which is runner 1 alone. `scripts/smoke/stack.ts` uses
  a fixed project name and fixed ports, and Docker's VM (7.75 GB) can't hold two smoke stacks next to
  the dev stack.
- `ci.yml`, `commits.yml`, `e2e.yml`: `pnpm/action-setup` installs pnpm into
  `${{ runner.temp }}/setup-pnpm`. The default, `~/setup-pnpm`, is shared by every runner of the same
  user.
- `release.yml`: the image matrix runs with `max-parallel: 1`. The runners share `~/.docker`, so one
  job's registry logout could break the other's push.
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
| `rw-light` for light jobs, `self-hosted` (runner 1) for the stacks | Everything on any runner; one runner for everything | Lint, tests and commit checks run in parallel, while the heavy stacks stay serial and fit in Docker's memory |
| `docker run` Postgres on a random port | Keep `services:`; a fixed port like 55432 | `services:` fails on macOS and Windows runners. A random port can't collide with the dev stack or a parallel job |
| Keep the stacks serial | Give each smoke run its own project name and ports | Two stacks don't fit in Docker's memory next to the dev stack, so parallel stacks would buy nothing |

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
- Only runner 1 may carry the `self-hosted` label. A second runner with it could start smoke and e2e
  at the same time on the same `rag-workspaces-smoke` project and ports. Runners get `self-hosted` by default, so keep it off any runner added later.
- The runner's machine needs enough free memory for the smoke stack (Langflow, Keycloak, Postgres,
  Chroma) next to any dev stack.

## Testing

This PR is its own test: its checks run on the self-hosted runner. Check that every job is green, and
that `docker ps` on the runner's machine shows no leftover `rw-ci-pg-*` container afterwards.

The first runs on the Mac showed two races that the hosted runners had hidden. Both are fixed in the
tests:

- `e2e/conversations.spec.ts` and `e2e/playground.spec.ts` read the stored conversation as soon as the
  reply's text was on screen. The API stores the reply a moment later, so they now poll until all four
  messages are stored.
- `e2e/workspaces.spec.ts` pressed Escape as soon as the create dialog was visible. It now waits until
  the dialog holds focus.

## Out of scope and follow-ups

- Going back to hosted runners once billing is fixed: change `runs-on` back. The Postgres step works
  there too.

## Docs updated

`AGENTS.md`: where CI runs, and what jobs must not assume.
