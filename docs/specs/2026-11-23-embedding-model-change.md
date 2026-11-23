---
title: change the embedding model from the settings page
date: 2026-11-23
pr: pending
status: in review
areas: [admin]
---

# Change the embedding model from the settings page

## Summary

The workspace settings page shows the embedding model as a read-only field, and the only way to change it
was the **Reindex workspace** button further down, which nothing pointed to. The field now has a
**Change…** button that opens the same reindex dialog. In that dialog the model is picked from a list of
what the provider serves, with the models whose id says they embed first, and another one can still be
typed.

## Why

Guilherme couldn't find how to change the embedding model (thread "Configure model providers in workspace
settings", 2026-11-23). The API has supported it since the reindex PR (#45,
`2026-11-23-workspace-reindex.md`); the admin UI's dialog came with the settings page. The field's hint
said "changes only through a reindex" without a way there, and the dialog offered the provider's whole
catalogue as free-text suggestions, so a chat model was as easy to pick as an embedding model.

## Design

1. **Settings page** (`apps/admin/src/routes/workspace-settings.tsx`): the embedding field stays
   read-only (`PATCH` refuses the model, decision recorded in the reindex spec) and gains a **Change…**
   button (accessible name "Change embedding model") that opens `ReindexDialog`. It is disabled under the
   same rule as the Reindex button: while a reindex runs, and while the form has unsaved changes, because a
   reindex ingests with the saved settings. The hint says so.
2. **Model list** (`embeddingModelChoices` in `apps/admin/src/workspaces/settings.ts`): splits the
   provider's models from `GET /v1/system` into those whose id contains `embed` and the rest. The model in
   use comes first even if the provider stopped listing it.
3. **Reindex dialog** (`apps/admin/src/components/reindex-dialog.tsx`): the model field is a select with
   two groups, "Embedding models" and "Other models", plus "Another model, type its id…", which turns it
   into a text box. With nothing to list (no system status, or the provider lists nothing) it is a text box
   as before. Switching provider clears the model, and switching back restores the one in use.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Open the existing reindex dialog | Make the field editable and reindex on Save | One place that starts a reindex, with its warning; Save stays a cheap, reversible action |
| Guess embedding models by `embed` in the id | Ask each provider which models embed | `GET /models` doesn't say for LM Studio, OpenAI or Gemini. The guess only orders the list; nothing is hidden |
| Keep "type its id" | Select only | A model the provider doesn't list yet (LM Studio loads on demand) must still be usable |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. A model change still runs a full reindex, which pauses asking and search for that workspace.

## Testing

- `apps/admin/src/workspaces/settings.test.ts`: `embeddingModelChoices` orders embedding models first,
  keeps a model in use that the provider no longer lists, and gives nothing to list without a system
  status.
- `apps/admin/e2e/workspace-settings.spec.ts`: the **Change embedding model** button opens the dialog with
  the workspace's provider and model filled in, and Cancel closes it.
- By hand: Settings, **Change…**, pick another model, **Reindex workspace**; the banner shows the
  reindex, and the field shows the new model when it ends.

## Out of scope and follow-ups

- Saving provider API keys per workspace and picking hosted models from a list: the next PRs of this
  thread.
- An "Advanced options" section on the create-workspace form.

## Docs updated

None needed: docs/architecture.md already says the embedding model changes through a reindex, and no route
changed.
