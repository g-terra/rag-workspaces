---
title: setup guide and API usage guide
date: 2026-11-23
pr: pending
status: in review
areas: [docs]
---

# Setup guide and API usage guide

## Summary

Two new pages, and a refreshed README:

- `docs/setup.md`: from an empty clone to a first answer. It covers requirements and memory, starting the
  stack, LM Studio or a hosted provider, signing in, adding people, API keys, updating, and a
  troubleshooting table.
- `docs/api.md`: authentication, then `curl` examples for upload, folders, search, ask, streaming, chat,
  feedback and usage, a `fetch` example, errors and rate limits.
- `README.md`: links to both, a current status line in place of "building milestone M0", and the table
  mapping the brief's `/ask`, `/chat` and `/retrieve` to our routes.

No code changed.

## Why

docs/work-breakdown.md plans `docs/setup.md` and `docs/api.md` for M2 (item 13), and lists them with the
README mapping table under the assignment's setup documentation. `docs/architecture.md` already pointed to
`docs/setup.md` for the hardware minimum. The backend those pages describe is now built (specs from
2026-11-21 to 2026-11-23).

## Design

1. `docs/api-schema.md` stays the reference for every route and field. `docs/api.md` is a task-ordered
   guide that links to it rather than repeating it.
2. `docs/setup.md` refers to the README's address table instead of copying it, so the URLs live in one
   place.
3. Every `curl` example and the `fetch` example in `docs/api.md` was run against the smoke stack with an
   `editor` key before committing.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Examples with an API key, not a person's token | Show getting a Keycloak token with `curl` | Password login is off in the realm, and scripts and agents are what keys are for |
| `curl` plus one `fetch` example | Examples in several languages | `curl` works from any shell; Node is already required by the repo |
| `docs/ingestion.md` and `docs/operations.md` left out | Write all four now | The plan puts them in M6, with backup and restore, which aren't built |
| Brief mapping table in the README | Only in `docs/api-schema.md` | The plan wants a marker to find it at once |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

- `pnpm format:check` passes.
- By hand, on the smoke stack (`http://localhost:13000`) with a fresh `editor` key for `ouc`, every example in
  `docs/api.md` ran: `GET /v1/me`, a two-file upload, search, ask, feedback (`200`), the stream (`token`,
  `citations`, `done` events), a conversation with two messages, the usage summary, and the `RateLimit-*` and
  `X-Request-Id` headers. The `fetch` example printed the answer and its citation.

## Out of scope and follow-ups

- `docs/ingestion.md` and `docs/operations.md` (M6).
- Screenshots in `docs/setup.md`, once the admin UI screens are merged.

## Docs updated

- `docs/setup.md` and `docs/api.md` (new).
- `README.md`: status, brief mapping table and links.
