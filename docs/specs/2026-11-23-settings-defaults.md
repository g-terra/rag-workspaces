---
title: show the real default values in workspace settings
date: 2026-11-23
pr: "#69"
status: merged
areas: [api, admin, docs]
---

# Show the real default values in workspace settings

## Summary

`GET /v1/system` now also returns `defaults.workspace`: the chunk size, chunk overlap, top-k, relevance
threshold and system prompt a workspace uses when it leaves that setting empty. The workspace Settings
screen shows them as placeholders ("Default: 800", the full default prompt in the system prompt box),
and the chat model field names the default model while the provider is left on the default.

## Why

Guilherme, 2026-11-23, with a screenshot of Settings where every retrieval field read just "Default":
"we need to see the default values". The values live in the API's environment (`DEFAULT_CHUNK_SIZE`,
`DEFAULT_CHUNK_OVERLAP`, `DEFAULT_TOP_K`, `DEFAULT_MIN_SCORE` in `apps/api/src/config.ts`) and in code
(`DEFAULT_SYSTEM_PROMPT` in `apps/api/src/services/generate.ts`), so the UI had no way to know them.
Builds on `2026-11-23-system-status.md` and `2026-11-23-admin-workspace-settings.md`. The old hint
"Empty uses the flow's own prompt" was also wrong: the API sends its own default prompt.

## Design

- `packages/shared/src/system.ts`: `WorkspaceDefaults` (`chunkSize`, `chunkOverlap`, `topK`,
  `minScore`, `systemPrompt`) and `SystemStatus.defaults.workspace`.
- `apps/api/src/routes/system.ts`: fills `defaults.workspace` from the config and
  `DEFAULT_SYSTEM_PROMPT`, the same values the ingest, search and answer services fall back to.
- `apps/admin/src/workspaces/settings.ts`: `defaultPlaceholder(system, field)` gives
  "Default: <value>", or plain "Default" when the status call failed; `chatModelDefault(system,
  provider)` names the default chat model while the provider is empty.
- `apps/admin/src/routes/workspace-settings.tsx`: the four number fields and the system prompt use
  `defaultPlaceholder`; the chat model field uses `chatModelDefault`, and its hint reads "Pick a
  provider to choose another model."

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Add to `GET /v1/system` | Return effective values on each workspace; a new `/v1/defaults` route | Settings already reads `/v1/system` for the chat default, and both are admin-only. Mixing effective values into the workspace would hide which settings are actually set |
| Placeholders, not pre-filled values | Fill the fields with the defaults | A filled field would be saved as an explicit setting and stop following `.env` changes |
| Non-breaking addition to the response | None | Existing readers ignore the new key |

## Interfaces and contracts

- **HTTP API**: `GET /v1/system` (admin) gains `defaults.workspace: { chunkSize, chunkOverlap, topK,
  minScore, systemPrompt }`. Nothing else changes.
- **Configuration**: None new; it reports the existing `DEFAULT_CHUNK_SIZE`, `DEFAULT_CHUNK_OVERLAP`,
  `DEFAULT_TOP_K`, `DEFAULT_MIN_SCORE`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. Restart the API to pick up changed `.env` defaults, as before.

## Testing

- `apps/api/src/routes/system.test.ts`: the response carries the configured defaults and the built-in
  prompt.
- `apps/admin/src/workspaces/settings.test.ts`: `defaultPlaceholder` for each field and without a
  status; `chatModelDefault` with an empty provider, a picked one and no status.
- `apps/admin/e2e/workspace-settings.spec.ts`: on a fresh workspace the chunk size, top-k, threshold and
  prompt fields show "Default: …" placeholders from the running API.
- By hand: open a workspace's Settings as an admin and read the placeholders; change `DEFAULT_TOP_K` in
  `.env`, restart the API, reload, and see the new number.

## Out of scope and follow-ups

- Defaults for non-admin users: Settings is admin-only, like `/v1/system`.
- The other playground fixes from the same request are separate PRs.

## Docs updated

`docs/api-schema.md`: the `/v1/system` example and the sentence on what Settings reads from it.
