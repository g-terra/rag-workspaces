---
title: set up a new workspace step by step
date: 2026-11-23
pr: "#98"
status: in review
areas: [admin, api, docs]
---

# Set up a new workspace step by step

## Summary

The admin UI's **Create workspace** dialog becomes a four-step wizard: **Basics** (name, slug,
description), **Models** (chat and embedding provider and model, a key for any hosted provider that has
none in `.env`, reasoning effort), **Retrieval** (chunk size and overlap, top-k, relevance threshold,
system prompt) and **Review**. Only the basics are required, and **Create workspace** works from any step:
whatever is left empty keeps the defaults from `.env`. A new admin route checks a typed key and lists the
provider's models before the workspace exists, and the keys are saved for the workspace once it is
created.

## Why

Guilherme asked to configure non-default models when creating a workspace, then for a setup wizard that
configures more at the start (thread "Configure model providers in workspace settings", 2026-11-23). The
embedding model matters most: it is fixed at creation and changing it later means a full reindex. The API
already took every setting on `POST /v1/workspaces` (`CreateWorkspace.settings`); only the UI was missing.
Builds on per-workspace keys (`2026-11-23-provider-keys.md`, decision 23).

## Design

1. **Wizard state and checks** (`apps/admin/src/workspaces/wizard.ts`): `WizardForm` is the settings
   page's `SettingsForm` plus slug and the embedding pair. `buildCreate` validates the basics with
   `validateCreate` and the settings with the settings page's own `validateSettings`, measured against a
   blank workspace so only filled-in fields are sent. It wants the embedding provider and model together,
   and refuses a hosted provider that has no key in `.env` (per `GET /v1/system`) and none typed. On
   failure it names the first step with a problem, and the dialog opens it. It also returns the typed keys
   to save, only for providers the workspace uses.
2. **Dialog** (`apps/admin/src/components/create-workspace-dialog.tsx`): step buttons at the top, **Back**,
   **Next: …** and **Create workspace** at the bottom. Model lists come from `GET /v1/system`, or from the
   key check for a provider that had no key. Embedding models whose id says `embed` are listed first. The
   hosted-provider warnings from the settings page show here too.
3. **Key check** (`POST /v1/providers/{provider}/models`, `apps/api/src/routes/providers.ts`, admin only):
   the same check as saving a key (`checkProviderKey`), without storing it, so the wizard can list models
   before the workspace exists. The key is neither stored nor logged.
4. **Creating**: `POST /v1/workspaces` with the settings, then `PUT …/providers/{provider}/key` for each
   checked key. The keys were checked already. If one still fails, the wizard opens the workspace's
   Settings instead of its home page, where the Provider keys section shows which one is missing.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Steps inside the existing dialog | A separate `/workspaces/new` page | Both entry points (the list and the switcher) keep working unchanged, and the quick path stays one screen |
| **Create workspace** on every step | Only on the last step | Most workspaces need only a name; the other steps are optional |
| No members step | Add people in the wizard | Members can be granted only once the workspace exists, and Settings already does it; it would mean a second round of requests after create |
| Keys held in the page until create, then saved | Create first, then ask for keys | Nothing is created until the whole setup is known to work, and a key typo shows on the step where it was typed |
| Reuse `validateSettings` against a blank workspace | A second validator | One set of rules and messages for create and edit |

## Interfaces and contracts

- **HTTP API**: `POST /v1/providers/{provider}/models` `{ apiKey }` (admin only): `200` `ProviderStatus`
  with the models, `422` when the provider refuses the key, `502` or `504` when it can't be asked, `400`
  for `lmstudio`, `403` for non-admins. Nothing is stored.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None (the key is never logged).

## Operations

None.

## Testing

- `apps/admin/src/workspaces/wizard.test.ts`: basics only sends no settings; filled-in settings and only
  the keys for providers in use; the step of the first problem; provider and model together; a hosted
  provider with no key anywhere; which providers still need a key; model lists from a checked key.
- `apps/api/src/routes/providers.test.ts`: the key check lists models, refuses a bad key without echoing
  it, takes no key for LM Studio, is admin only, and stores nothing.
- `apps/admin/e2e/workspaces.spec.ts`: the existing quick create still works from step one; a new test
  walks the steps (an LM Studio model from the list, a made-up Gemini key refused, the wizard refusing to
  create Gemini without a key, top-k on the retrieval step, the review), creates, and finds the settings in
  Settings.

## Out of scope and follow-ups

- Granting members in the wizard (Settings does it after create).
- Folders at creation.

## Docs updated

`docs/api-schema.md` (the key check route).
