---
title: Rename flow endpoints to rw-*
date: 2026-11-20
pr: '#14'
status: merged
areas: [flows, api, docs]
---

# Rename flow endpoints to rw-*

## Summary

Renames the four Langflow flows from the spike's `rag-*` names to the `rw-*` endpoint names used in
`docs/architecture.md`: `rw-ingest`, `rw-retrieve`, `rw-answer` and `rw-delete`. Only `name` and
`endpoint_name` change in the flow JSON; flow ids stay the same.

## Why

The architecture names flows after the project (`rw-` for rag-workspaces); the spike used placeholder
names. Renaming before the first PR that runs a flow (#16) avoids a rename under live use.

## Design

- `flows/*.json`: `name` and `endpoint_name` only.
- `apps/api/src/flows.ts`: `FLOWS` constants.
- Tests, `flows/README.md`, one line in `docs/architecture.md`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Keep flow ids | New flows with new ids | Langflow updates the existing flows in place; nothing to clean up |
| Leave `poc/` as it ran | Rename there too | The spike stays a frozen reference |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: endpoint names are now `rw-ingest`, `rw-retrieve`, `rw-answer`, `rw-delete`.
- **Events and logs**: `/ready` reports `flows missing in Langflow: rw-...` if API and flows disagree.

## Operations

API and Langflow must be restarted together (`docker compose up -d --build`), otherwise `/ready` says the
flows are missing until both run the new version.

## Testing

Existing tests updated. On the stack: after a Langflow restart its database lists the four `rw-*` flows
with the same ids, and `/ready` is ok.

## Out of scope and follow-ups

The POC generator (`poc/client/build-flows.ts`) still writes `rag-*` into `poc/flows/`; the conversations
change (#21) points it at `flows/`.

## Docs updated

`flows/README.md` (names, and how to bring a regenerated flow over), `docs/architecture.md`.
