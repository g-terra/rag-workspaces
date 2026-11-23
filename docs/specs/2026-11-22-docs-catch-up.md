---
title: Bring the architecture, API schema and decisions up to date with the built stack
date: 2026-11-22
pr: '#30'
status: in review
areas: [docs]
---

# Bring the architecture, API schema and decisions up to date with the built stack

## Summary

The long-lived docs described the planned design and had drifted from what the PR stack actually built.
This marks what is built and what is still planned, fixes the places where the code went a different
way, and records one decision made during review. Docs only.

## Why

AGENTS.md rule 6 (keep docs true). The owner asked for the docs to be brought back up to speed with the
changes (2026-11-22). Agents read these docs first, so drift sends them the wrong way.

## Design

- `docs/architecture.md`:
  - new **Status** table (built vs not built yet, pointing to `docs/specs/`);
  - provider keys are read by the API and sent as tweaks (the old "Langflow reads them as global
    variables" line contradicted the F3 finding further down);
  - easy start uses `pnpm env:init` and `--build`; the video profile is marked M5.
- `docs/api-schema.md`:
  - *(planned)* markers on folders, workspace reindex and status, `GET /v1/users`, `GET /v1/system`,
    transcripts, document `PATCH`, rate limits, `stats`, per-key request counts, `folderId` fields;
  - answer example matches `packages/shared/src/answers.ts` (`status`, `grounded`, `rank`, `provider`,
    `timeToFirstTokenMs`, `error`, `feedback`; no `folderId`/`startSeconds` yet);
  - workspace example gains `access` and `updatedAt`; embedding fields are refused by `PATCH` (400);
  - upload uses `files` parts; one bad file rejects the request; empty file 400;
  - SSE event names; usage report fields, scopes, defaults, 499 and route patterns;
  - API key `GET` by id, role immutable, revoke keeps the row;
  - errors table: 409 for processing documents and revoked keys, 502 for an empty model answer, 503 for
    Langflow not ready, missing provider key or Keycloak unreachable;
  - answers and conversations visible only to their creator and admins.
- `docs/decisions.md`: decision 21, answers and conversations are private.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Keep the docs as the full design and mark unbuilt parts *(planned)* | Cut planned parts out | The plan stays readable in one place; markers stop agents assuming a route exists |
| One catch-up PR on top of the stack | Fix docs inside each stacked PR | Restacking 18 PRs for doc lines would churn every review; future PRs follow rule 6 |
| Record answer privacy as decision 21 | Leave it in the PR thread | It shapes every future route that stores user content |

## Interfaces and contracts

- **HTTP API**: None changed; the schema doc now matches the code.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

Checked each changed statement against the code on this branch: `packages/shared/src/*.ts` shapes,
`apps/api/src/routes/*.ts` routes and status codes, `apps/api/src/config.ts` settings.

## Out of scope and follow-ups

`docs/work-breakdown.md` milestones are unchanged. The planned items above get their own specs when built.

## Docs updated

`docs/architecture.md`, `docs/api-schema.md`, `docs/decisions.md`.
