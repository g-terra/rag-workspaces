---
title: Monorepo foundation with pnpm workspaces, Turborepo, Prettier and CI
date: 2026-11-20
pr: '#4'
status: merged
areas: [ci, infra]
---

# Monorepo foundation with pnpm workspaces, Turborepo, Prettier and CI

## Summary

Sets up the repository as a pnpm + Turborepo monorepo with formatting rules and a CI workflow. It adds
no packages: `apps/*` and `packages/*` become workspace locations that later PRs fill. Every later PR
builds, lints, type-checks and tests through the commands defined here.

## Why

Decision 10 in `docs/decisions.md` (Turborepo + pnpm, tests in CI). Several apps and packages share code
(API, admin UI, db schema, Langflow client), and they must build in dependency order with cached results.

## Design

- `pnpm-workspace.yaml` declares `apps/*` and `packages/*` as workspace packages.
- Root `package.json` pins `packageManager: pnpm@10.28.0` (so `corepack enable` gives everyone the same
  pnpm) and defines `build`, `test`, `lint`, `typecheck`, `format` and `format:check`, which call
  `turbo run <task>` or Prettier.
- `turbo.json`: `typecheck`, `lint` and `test` depend on `^build`, so a package always sees the compiled
  output of the packages it imports; `build` caches `dist/**`; `dev` is persistent and uncached.
- `.prettierrc.json` (single quotes, width 110, trailing commas), `.prettierignore`, `.editorconfig`,
  `.nvmrc` (Node 22.18).
- `.github/workflows/ci.yml`, job "Lint, typecheck, test, build": `pnpm install --frozen-lockfile`, then
  `format:check`, `lint`, `typecheck`, `test`, `build`, on every PR and on `main`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Exact dependency versions, no `^` | Caret ranges | Reproducible installs; upgrades are deliberate PRs |
| Prettier skips Markdown, `docs/` and `poc/` | Format everything | Plan docs keep their hand formatting; `poc/` is a frozen reference |
| Shared TS/ESLint/Vitest config arrives with the first package (#5) | Add it here | AGENTS.md rule 1: nothing before it is needed |
| Regenerate `pnpm-lock.yaml` from what exists | Keep the old lockfile | The old one listed packages from later PRs |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None. Node 22.18 (`.nvmrc`), pnpm 10.28.0 (`packageManager`).
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None. CI job name "Lint, typecheck, test, build" is what branch protection can
  require.

## Operations

Config only; nothing hard to undo. Developers run `corepack enable && pnpm install` once.

## Testing

No code to test. CI passes against zero packages:
`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Out of scope and follow-ups

Shared configs and the first package come with the API skeleton
([2026-11-20-api-skeleton.md](2026-11-20-api-skeleton.md)). Commit-message checks and release-please were
added separately (#25).

## Docs updated

`README.md` and `AGENTS.md` list the commands.
