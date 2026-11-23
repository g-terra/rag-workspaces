---
title: save hosted provider keys per workspace
date: 2026-11-23
pr: pending
status: in review
areas: [api, db, docs, infra]
---

# Save hosted provider keys per workspace

## Summary

Admins can save an OpenAI, Gemini or Anthropic API key for one workspace through the API, and that key is
then used instead of the one in `.env` for the workspace's ingestion, search, answers and chat. Keys are
checked against the provider before they are saved, stored encrypted, and never returned (only their last
four characters). A second route checks a key and lists the provider's models without saving it, for
setting up a workspace that doesn't exist yet. The admin UI for both comes in the next PRs.

## Why

Picking Gemini in a workspace's settings showed "no API key set" and a free-text model id, and the only fix
was to edit `.env` and restart the API (thread "Configure model providers in workspace settings",
2026-11-23). Guilherme asked to enter the key in the UI and pick models from a list, and chose on a decision
card to keep keys per workspace, encrypted, with `.env` as the fallback. Builds on decision 19 (hosted
providers are a setting) and keeps POC finding F3 (keys never sit in Langflow's environment). Recorded as
decision 23.

## Design

1. **Storage** (`packages/db/src/schema.ts`, migration `0009_provider_keys.sql`): table `provider_keys`,
   one row per workspace and provider (primary key on both), with the sealed key, its last four
   characters, who saved it and timestamps. Deleting the workspace deletes its rows (`on delete cascade`).
2. **Encryption** (`apps/api/src/services/secrets.ts`): AES-256-GCM with a fresh 12-byte IV per value. The
   AES key is derived from `SECRETS_KEY` with HKDF-SHA256. `<workspaceId>:<provider>` is bound as additional
   data, so a sealed key copied to another row won't open. Stored as `v1.<base64url(iv | tag | ciphertext)>`.
   Anything that won't open throws `SecretUnreadable`.
3. **Using the keys** (`apps/api/src/services/provider-keys.ts`, `withWorkspaceKeys`): returns the API's
   config with each saved key in place of `.env`'s. Called where a workspace's provider is resolved:
   `Generator.run` (answers and chat), `GET .../passages`, `IngestProcessor` and `startReindex`. A saved key
   that can't be opened becomes empty, so a run that needs it fails with "… is not set" instead of quietly
   using `.env`'s key.
4. **Routes** (`apps/api/src/routes/providers.ts`, admin only):
   - `GET /v1/workspaces/{slug}/providers`: every provider as `ProviderStatus` plus
     `key: { source: 'workspace' | 'env' | null, last4 }`, asked for its models with the key the workspace
     would use (`ModelCatalog` built on the merged config).
   - `PUT /v1/workspaces/{slug}/providers/{provider}/key` `{ apiKey }`: asks the provider for its models
     with the key (`ModelCatalog.provider`, now public), saves it sealed when that works (upsert), and
     answers with the provider as the workspace now sees it.
   - `DELETE /v1/workspaces/{slug}/providers/{provider}/key`: `204`, or `404` when none was saved.
   - `POST /v1/providers/{provider}/models` `{ apiKey }`: the same check without saving, for the
     create-workspace wizard.
5. **Configuration**: `SECRETS_KEY` in `apps/api/src/config.ts`, `.env.example` (`<generated>`, so
   `pnpm env:init` adds it to an existing `.env` too) and the API's environment in `docker-compose.yml`.
   `buildApp` takes `providerFetch` so tests can stand in for the providers.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Per workspace, `.env` as fallback | One global key per provider; write `.env` from the UI | Guilherme's pick on the decision card. Writing `.env` would need the API to write its own config and restart |
| AES-256-GCM, key from `SECRETS_KEY` via HKDF | Store plain text; hash (can't be used); pgcrypto | The key has to be used, so it must be decryptable. Doing it in the API keeps the database dump useless without `.env` |
| Workspace and provider bound as additional data | Plain encryption | A row copied or swapped in the database fails to open instead of leaking a key into another workspace |
| Check the key with the provider before saving | Save anything, fail at the first run | A typo shows at once with the provider's own reason, and the model list is ready right after |
| Unreadable saved key means "not set", not `.env`'s key | Fall back to `.env` | An admin who saved a key for a workspace chose where its material goes; silently using another key (maybe another provider account) would break that |
| Saving needs `SECRETS_KEY`, reading `.env` keys doesn't | Refuse to start without it | Existing installs keep working; saving answers `503` with how to fix it |
| `last4` stored separately | Decrypt to show it | Listing needs no decryption, and four characters identify a key without exposing it |

## Interfaces and contracts

- **HTTP API**: `GET /v1/workspaces/{slug}/providers` (200, `WorkspaceProvider[]`),
  `PUT /v1/workspaces/{slug}/providers/{provider}/key` (200 `WorkspaceProvider`; 400 for `lmstudio`, 422
  when the provider refuses the key, 503 without `SECRETS_KEY`), `DELETE` on the same path (204, 404),
  `POST /v1/providers/{provider}/models` (200 `ProviderStatus`; 400, 422). All admin only: a workspace
  member gets 403. Types in `packages/shared/src/providers.ts` (`HostedProvider`, `WorkspaceProvider`,
  `SetProviderKey`).
- **Configuration**: `SECRETS_KEY`, generated by `pnpm env:init`, no default. Changing it makes every
  saved key unreadable.
- **Data**: new table `provider_keys` (migration `0009_provider_keys.sql`).
- **Langflow**: None. Keys still travel as tweaks per run, as before.
- **Events and logs**: `provider key saved` and `provider key removed` (workspace, provider, admin id;
  never the key).

## Operations

- Existing install: run `pnpm env:init` (adds `SECRETS_KEY` to `.env`, leaves the rest), then
  `docker compose up -d api`. The migration runs on start.
- Keep `SECRETS_KEY` with the database backup: without it the saved keys can't be read. If it is lost or
  changed, `GET .../providers` says so for each saved key, and saving the keys again fixes it.
- A refused key shows the provider's reason (for example "Gemini refused the key (HTTP 400)").

## Testing

- `apps/api/src/services/secrets.test.ts`: round trip, a fresh IV each time, refusal with another
  `SECRETS_KEY`, another workspace or provider, and tampered or malformed values.
- `apps/api/src/routes/providers.test.ts` (Postgres): listing with key sources, saving only a key the
  provider accepts, the key never in a response and not in plain text in the row, keys staying with their
  workspace, `withWorkspaceKeys` with and without a saved key, admin only, removal back to `.env`, cascade
  on workspace delete, the unsaved key check, and `503` without `SECRETS_KEY`.
- `apps/api/src/services/ingest.test.ts`: a workspace with its own key embeds with it.
- By hand: `PUT /v1/workspaces/ouc/providers/gemini/key` with a real key in Swagger, then
  `GET .../providers` lists Gemini's models with `source: "workspace"`.

## Out of scope and follow-ups

- The admin UI to save and remove keys in workspace settings, with the chat model picked from the list
  (next PR).
- A step-by-step wizard to create a workspace with its models, keys and settings (the PR after).
- A global key saved from the UI: `.env` stays the global place.

## Docs updated

`docs/api-schema.md` (provider keys section and resources table), `docs/architecture.md` (where keys come
from), `docs/decisions.md` (decision 23), `docs/setup.md` (saving a key in the UI, `SECRETS_KEY` on an
older install), `.env.example`, `docker-compose.yml`, `docs/HANDOVER.md` (decision count).
