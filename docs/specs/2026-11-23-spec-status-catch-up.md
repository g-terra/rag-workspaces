---
title: mark merged specs as merged
date: 2026-11-23
pr: "#40"
status: merged
areas: [docs]
---

# Mark merged specs as merged

## Summary

Fifteen specs in `docs/specs/` still said `status: in review` after their pull requests were merged on
2026-11-23 in one batch. This sets each of them to `status: merged`, so the spec history matches `main`.

## Why

Rule 7 in `AGENTS.md` makes the specs the history of how the system got here, and readers use the
`status` field to tell what is live. The batch merge of the review stack (#20 to #39, #31, #32) skipped
the usual "mark the spec merged before merging" step to avoid racing pushes against the merges.

## Design

A front-matter edit only: `status: in review` becomes `status: merged` in these files:

- `2026-11-20-answer-streaming.md`, `2026-11-20-conversations.md`, `2026-11-20-release-versioning.md`,
  `2026-11-20-usage-analytics.md`, `2026-11-20-usage-log.md`
- `2026-11-22-admin-create-workspace.md`, `2026-11-22-admin-library.md`,
  `2026-11-22-admin-live-status.md`, `2026-11-22-admin-sign-in.md`, `2026-11-22-admin-upload.md`,
  `2026-11-22-admin-workspaces.md`
- `2026-11-22-compose-smoke-test.md`, `2026-11-22-docs-catch-up.md`,
  `2026-11-22-knowledge-base-spike.md`, `2026-11-22-setup-cli-plan.md`

No other text in those specs changes.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| One catch-up PR on `main` | Push the status change to each PR branch before merging | The branches were being merged one after another; pushing to them made merges fail with "head modified". |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

`grep -l "^status: in review" docs/specs/2026-*.md` lists only this spec. `pnpm format:check` passes.

## Out of scope and follow-ups

None.

## Docs updated

None needed: only spec front matter changes.
