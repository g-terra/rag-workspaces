---
title: Langflow client; the API creates its Langflow key on start and checks its dependencies
date: 2026-11-20
pr: '#7'
status: in review
areas: [langflow-client, api, infra]
---

# Langflow client; the API creates its Langflow key on start and checks its dependencies

## Summary

Adds `packages/langflow-client`, a small typed client for Langflow's REST API. On every start the API
signs in to Langflow as the superuser, creates its own API key and deletes the keys it created before,
so a fresh install needs no manual key. `/ready` now checks Chroma, Keycloak and Langflow (healthy, key
present, all four flows imported).

## Why

Decision 17 (the API gets its Langflow key automatically; `LANGFLOW_API_KEY` is the fallback) and
decision 18 (only the API calls Langflow). POC finding F4: Langflow shows a key's value only once and
rate-limits `/login`.

## Design

1. `apps/api/src/main.ts` builds the app with three readiness checks, starts listening, **then** calls
   `langflow.start()`, so `/health` answers while Langflow is still booting.
2. `apps/api/src/services/langflow.ts` (`LangflowService.attempt`): if `LANGFLOW_SUPERUSER_PASSWORD` is
   set, call `provisionApiKey`; on success keep the key in memory (`keySource = 'auto'`). On failure use
   `LANGFLOW_API_KEY` if set (`'env'`); otherwise retry in the background after 2 s, 4 s, 8 s ...
   capped at 60 s.
3. `packages/langflow-client/src/bootstrap.ts` (`provisionApiKey`): log in, list keys named
   `rag-api-*`, create `rag-api-<ISO timestamp>`, delete the old ones.
4. `packages/langflow-client/src/client.ts`: `request()` plumbing (sends `x-api-key`, turns non-2xx into
   `LangflowError` with Langflow's message), `healthy()`, `login()` (honours 429 `retry_after` up to 4
   attempts), API key create/list/delete, `listFlows()`.
5. Readiness: `services/checks.ts` has `chromaCheck` (`/api/v2/heartbeat`) and `keycloakCheck` (realm
   discovery document via the internal URL); `LangflowService.readinessCheck()` requires health, a key,
   and every endpoint in `apps/api/src/flows.ts`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| New key on every start, kept in memory only | Persist the key in a file or the database | Langflow can't show it again; a stored key is a secret on disk that can leak |
| Delete older `rag-api-*` keys | Leave them | Keys would pile up on every restart |
| Listen first, fetch the key after | Block startup until Langflow is up | `/health` stays truthful; `/ready` says not ready until the key and flows exist |
| Langflow imports the flows; the API only checks them | API uploads flows | Langflow's `LANGFLOW_LOAD_FLOWS_PATH` already updates them by fixed id on start |
| Client package with no dependencies | Use a generated OpenAPI client | Few endpoints, and Langflow's spec is loose; thin wrappers are easier to test |

## Interfaces and contracts

- **HTTP API**: `GET /ready` now 503 when Chroma, Keycloak or Langflow fails (body unchanged).
- **Configuration**: `LANGFLOW_URL` (http://langflow:7860), `LANGFLOW_SUPERUSER` (admin),
  `LANGFLOW_SUPERUSER_PASSWORD`, `LANGFLOW_API_KEY` (optional fallback), `CHROMA_URL`
  (http://chroma:8000), `KEYCLOAK_INTERNAL_URL` (http://keycloak:8080), `KEYCLOAK_REALM`
  (rag-workspaces). Empty strings count as unset.
- **Data**: Langflow API keys named `rag-api-<timestamp>` belong to the API; don't create keys with that
  prefix by hand.
- **Langflow**: flow endpoint names `rag-ingest`, `rag-retrieve`, `rag-answer`, `rag-delete` must exist
  (renamed to `rw-*` later). Endpoints used: `/health_check`, `/api/v1/login`, `/api/v1/api_key/`,
  `/api/v1/flows/`.
- **Events and logs**: `created a Langflow API key` (with `revoked` count), `could not create a Langflow
  API key`, `using LANGFLOW_API_KEY from the environment`, `not ready` with the failed checks.

## Operations

- Run exactly **one** API process per Langflow; two would keep deleting each other's keys.
- The API now holds the Langflow superuser password (same `.env` as Langflow).
- Edits made in the Langflow editor are overwritten on the next Langflow start; export them to `flows/`.

## Testing

`packages/langflow-client/src/client.test.ts` (fake `fetch`: headers, errors, 429 retry, key
rotation), `apps/api/src/services/langflow.test.ts` (auto key, env fallback, retry schedule, readiness
rule naming missing flows), `apps/api/src/services/checks.test.ts`. By hand: `docker compose logs api |
grep -i "langflow api key"`; restart the API and see one `rag-api-*` key in Langflow's settings;
`docker compose stop chroma` makes `/ready` 503.

## Out of scope and follow-ups

Postgres readiness (#8). `run()` and output helpers (#16), `stream()` (#20). Admin detail of checks in
`GET /v1/system` (later).

## Docs updated

`.env.example`, `README.md`. Decision 17 already described the behaviour.
