---
title: system status for admins, with the models each provider offers
date: 2026-11-23
pr: pending
status: in review
areas: [api, docs]
---

# System status for admins, with the models each provider offers

## Summary

`GET /v1/system` (admins only) shows what `/ready` hides. It gives each service's state, with its latency or
the reason it failed. It also lists every model provider with the models it offers right now, says whether
the default chat and embedding models are among them, and says where the API's Langflow key came from. It
always answers `200`, so the admin UI can show a banner explaining what is wrong. It also feeds the model
pickers in workspace settings.

## Why

- docs/architecture.md ("Readiness") and docs/work-breakdown.md (M2 item 11, M4 item 9) plan an admin
  view of the dependencies. The most common failure is LM Studio not running or a model not downloaded,
  and today that only shows up as a failed ingest or answer.
- The admin UI's settings screen needs the list of models it can offer when changing a workspace's model
  (reindex, docs/specs/2026-11-23-workspace-reindex.md).

## Design

1. **Route** (`apps/api/src/routes/system.ts`): `requireAdmin`. Two things run in parallel, each limited
   to `READY_TIMEOUT_MS`:
   - the same `ReadinessCheck`s `/ready` uses (`runChecks`, `apps/api/src/readiness.ts`): postgres,
     chroma, keycloak and langflow, where langflow covers its health, the key and the five flows;
   - `ModelCatalog.status()`.
2. **`ModelCatalog`** (`apps/api/src/services/models.ts`) asks each provider `GET .../models` with its own
   key from `.env`:
   - LM Studio: `LMSTUDIO_BASE_URL/models`.
   - OpenAI: `api.openai.com/v1/models`.
   - Gemini: its OpenAI-compatible `/v1beta/openai/models`. Ids lose their `models/` prefix to match what
     the flows take.
   - Anthropic: `/v1/models?limit=1000` with `x-api-key` and `anthropic-version`.
   - A hosted provider without a key isn't asked. Failures come back in words, for example "could not
     reach LM Studio at ... Is it running, with its server started?" or "OpenAI refused the key (HTTP
     401)".
3. **Defaults.** `DEFAULT_CHAT_*` and `DEFAULT_EMBEDDING_*` are `available` only when their provider is
   configured, answers, and lists the model.
4. **`status`** is `ok` when every service is up and both defaults are available, otherwise `degraded`.
5. **Langflow key.** `langflowKey` reads `LangflowService.keySource`, passed into `buildApp` as a function
   from `apps/api/src/main.ts`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Model providers are not in `/ready` | Add an LM Studio check to `/ready` | Compose and the smoke test gate on `/ready`; a laptop with LM Studio closed should still start the stack and serve the library. The `/ready` description that mentioned the model provider is corrected |
| Always `200`, with `status: degraded` | `503` when something is down | The admin UI needs the body most when something is down |
| Ask providers live on every request | Cache the lists | Admin-only and cheap. After loading a model in LM Studio, the admin expects to see it at once |
| One flat `models` list per provider, plus `embeddings: false` for Anthropic | Split chat and embedding models | Only LM Studio's own API says which is which, and the OpenAI-compatible lists don't. The UI can filter by name when it needs to |
| Hosted providers asked only when their key is set | Always list them | Nothing to ask without a key. `configured: false` with "OPENAI_API_KEY is not set" says what to do |

## Interfaces and contracts

- **HTTP API**: `GET /v1/system`, admin only (`401` without a token, `403` for non-admins), always `200`.
  The shape is `SystemStatus` in `packages/shared/src/system.ts`:
  - `version`
  - `status`: `ok` or `degraded`
  - `services[]`: `{ name, ok, latencyMs, error }`
  - `langflowKey`: `auto`, `env` or `none`
  - `providers[]`: `{ id, configured, reachable, error, models, embeddings }`, always in the order
    lmstudio, openai, gemini, anthropic
  - `defaults.chat` and `defaults.embedding`: `{ provider, model, available }`
- **Configuration**: None new. It uses `READY_TIMEOUT_MS`, the provider keys, `LMSTUDIO_BASE_URL` and the
  `DEFAULT_*` model settings.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Nothing to do on upgrade. Each call makes up to four outbound requests to the model providers, with the
keys already in `.env`, and only to providers whose key is set.

## Testing

- `apps/api/src/services/models.test.ts`:
  - LM Studio's models come back sorted, and providers without a key are not asked.
  - Each hosted provider gets its own key and header, and Gemini's ids lose their prefix.
  - LM Studio down and a refused key are explained in words.
- `apps/api/src/routes/system.test.ts`:
  - The full body when all is well.
  - A failing service makes it `degraded`, still `200`, with the reason.
  - A missing default model, or LM Studio down, makes it `degraded`.
  - `403` and `401` for the wrong callers.
- `scripts/smoke/check.ts`: on the real stack every service is up, the Langflow key is `auto`, and the
  stand-in model server lists the embedding default.

By hand: `curl -s -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/v1/system`, then stop
LM Studio and call it again to see `reachable: false` and `status: degraded`.

## Out of scope and follow-ups

- The admin UI banner and the model pickers are built by the admin UI thread.
- Custom OpenAI-compatible providers (mentioned in docs/api-schema.md) still don't exist in config.

## Docs updated

- `docs/api-schema.md`: the System resource with an example, and the provider note in workspace
  settings.
- `docs/architecture.md`: status table.
- The `/ready` route description and the `readiness.ts` comment no longer claim it checks the model
  provider.
