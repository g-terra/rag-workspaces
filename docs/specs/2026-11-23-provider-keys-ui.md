---
title: add provider keys and pick hosted models in workspace settings
date: 2026-11-23
pr: "#97"
status: in review
areas: [admin]
---

# Add provider keys and pick hosted models in workspace settings

## Summary

The workspace settings page gets a **Provider keys** section: one row each for OpenAI, Google Gemini and
Anthropic, saying where the workspace's key comes from (saved for this workspace, ending in `x9Qa`; the
API's `.env`; or none) with **Add key**, **Replace key** and **Remove** buttons. Picking a chat provider
that has no key offers **Add … key** right under the picker. The model pickers now read the providers as
this workspace sees them, so once a key is saved the chat model becomes a list of that provider's models,
and the provider can be picked in the embedding model dialog.

## Why

Picking Gemini showed "no API key set" and a free-text model id, and Guilherme wanted to enter the key
and pick models in the UI (thread "Configure model providers in workspace settings", 2026-11-23). The API
for per-workspace keys came in the previous PR (`2026-11-23-provider-keys.md`, decision 23).

## Design

1. **Queries** (`apps/admin/src/workspaces/providers.ts`): `useWorkspaceProviders` reads
   `GET /v1/workspaces/{slug}/providers`; `useSaveProviderKey` (`PUT …/{provider}/key`) and
   `useRemoveProviderKey` (`DELETE`) refresh it. Pure helpers: `keyNote` (the row's text),
   `withWorkspaceProviders` and `providerKeyErrorMessage`.
2. **Settings page** (`apps/admin/src/routes/workspace-settings.tsx`): the system status from
   `GET /v1/system` keeps its defaults and health, but its `providers` are replaced by the workspace's
   list once it arrives (`withWorkspaceProviders`). Every existing picker (chat provider, chat model,
   reindex dialog) is built on that, so none of them changed. Until the list arrives they show the
   system's providers as before.
3. **Key rows and dialog** (`apps/admin/src/components/provider-keys.tsx`): `ProviderKeys` lists the three
   hosted providers. `ProviderKeyDialog` asks for the key in a password field (no autocomplete) and shows
   the API's answer when the provider refuses it. The key is never shown after it is typed.
4. **Inline prompt**: when the chosen chat provider is hosted and not configured for this workspace, a
   line under the picker says why its models can't be listed, with an **Add … key** button that opens the
   same dialog.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Its own section with one row per provider | Key field only under the chat provider | An embedding-only provider (Gemini embeddings with LM Studio chat) needs a key too |
| Swap the workspace's providers into the system status | Rewrite the picker helpers to take a provider list | Every picker keeps working unchanged and keeps its tests |
| Saving a key takes effect at once, outside "Save changes" | Hold it until Save | The API checks and stores it on its own route. Holding a secret in page state for longer would gain nothing |

## Interfaces and contracts

- **HTTP API**: None new; uses the routes from `2026-11-23-provider-keys.md`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. Saving needs `SECRETS_KEY` in the API's `.env` (`pnpm env:init`); without it the dialog shows the
API's explanation.

## Testing

- `apps/admin/src/workspaces/providers.test.ts`: row text for each key source and with a provider error,
  never more than the last four characters; the provider swap; error messages.
- `apps/admin/e2e/workspace-settings.spec.ts`: three rows with no key on the smoke stack; the dialog's
  field is a password field; a made-up OpenAI key is refused and nothing is saved; picking Gemini as chat
  provider offers **Add gemini key**.
- By hand: Settings, **Provider keys**, **Add key** for Gemini with a real key; the row says "Saved for
  this workspace, ending in …", the chat model for Gemini becomes a list, and Gemini is offered in
  **Change…** for the embedding model.

## Out of scope and follow-ups

- The step-by-step wizard for a new workspace (next PR).
- Telling chat models from embedding models in the chat list: providers don't say, so the chat list stays
  the provider's whole catalogue, as before.

## Docs updated

None needed: `docs/api-schema.md` and `docs/setup.md` were updated with the API in the previous PR, and
the admin UI has no separate guide.
