---
title: Pick the reasoning effort on the workspace settings page
date: 2026-11-23
pr: "#87"
status: merged
areas: [admin, docs]
---

# Pick the reasoning effort on the workspace settings page

## Summary

The admin UI's workspace settings page has a "Reasoning effort" select under the chat model. Its options are
Default, none, minimal, low, medium and high. Its note says what Default means here: the `.env` default
named by `GET /v1/system`, or "not sent, so the model decides" when there is none. Saving sends
`settings.reasoningEffort`, and choosing Default sends `null`.

## Why

The API setting (2026-11-23-reasoning-effort.md) lets a workspace stop a thinking model such as Qwen 3 from
reasoning for minutes before each answer. The tuning work asked for it in the admin settings, since that is
where an admin changes the chat model it belongs to.

## Design

1. `apps/admin/src/workspaces/settings.ts`: `SettingsForm` gains `reasoningEffort` (a string, `''` for the
   default). `formFor` fills it, and `validateSettings` sends it only when changed, as the value or
   `null`. `REASONING_EFFORTS` lists the options from the shared `ReasoningEffort` enum.
   `reasoningDefaultNote` words the default.
2. `apps/admin/src/routes/workspace-settings.tsx`: a `Field` with a select in the "Model and retrieval"
   section, after the chat provider and model.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A select of the five values plus Default | A text field | The API accepts only these, so a select can't be wrong. |
| Shown for every provider | Hidden unless the provider is LM Studio or OpenAI | The provider can be the default, which this page may not resolve. The note says which providers receive it. |

## Interfaces and contracts

- **HTTP API**: None. It uses `settings.reasoningEffort` and `defaults.workspace.reasoningEffort`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. Rebuild the admin UI image.

## Testing

- `apps/admin/src/workspaces/settings.test.ts`: a picked value is sent, Default sends `null`, the form reads
  a set value, and the note names the default or says nothing is sent.
- `apps/admin/e2e/workspace-settings.spec.ts`: on the smoke stack, the note says nothing is sent, `none` is
  picked and saved, and it is still selected after a reload.

## Out of scope and follow-ups

None.

## Docs updated

`README.md` (what the settings page changes).
