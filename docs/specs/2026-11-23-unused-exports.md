---
title: Stop exporting helpers nothing imports
date: 2026-11-23
pr: "#102"
status: in review
areas: [api, db]
---

# Stop exporting helpers nothing imports

## Summary

Four names lose their `export` because no other file, and no test, imports them: `API_KEY_PREFIX`
(`apps/api/src/auth/api-keys.ts`), `httpCheck` (`apps/api/src/services/checks.ts`), `citesAny`
(`apps/api/src/services/generate.ts`) and `MIGRATIONS_DIR` (`packages/db/src/client.ts`). Behaviour does
not change.

## Why

AGENTS.md rule 1 ("no 'for later' exports"). The codebase review after the Antigravity work
(`2026-11-23-retire-handover.md`) searched every exported value in `apps/*/src`, `packages/*/src` and
`scripts/` for importers. These four were the only exported values used nowhere but their own file. The
other exports with no importer outside their file are either imported by tests (pure helpers tested on
their own, which the repo does on purpose), Drizzle enums the schema needs, or types.

## Design

Remove the `export` keyword from each of the four declarations. Every use stays inside its own module:

- `API_KEY_PREFIX` builds and recognises `rw_` secrets in `api-keys.ts`.
- `httpCheck` backs `chromaCheck` and `keycloakCheck` in `checks.ts`.
- `citesAny` decides `grounded` in `generate.ts`.
- `MIGRATIONS_DIR` is the folder `runMigrations` reads in `client.ts`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Unexport only values used nowhere else | Also unexport types and helpers that only tests import | Exported types document a module's shape at no runtime cost, and the tested helpers are exported so their tests can reach them |
| Remove `export` from `MIGRATIONS_DIR` even though `packages/db` is a package | Keep it as public package API | No package imports it; `runMigrations` is the public way in. Rule 1 says to add it back when something needs it |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

No behaviour changes, so no new tests. `pnpm typecheck` would fail if anything still imported these
names; `pnpm test` (288 API and 6 db tests against Postgres) covers the code that uses them.

## Out of scope and follow-ups

None.

## Docs updated

None needed: no long-lived doc names these helpers.
