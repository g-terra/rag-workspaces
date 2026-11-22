---
title: Docker compose stack with Postgres, Chroma, Langflow, Keycloak and the API image
date: 2026-11-20
pr: '#6'
status: merged
areas: [infra, flows, ci]
---

# Docker compose stack with Postgres, Chroma, Langflow, Keycloak and the API image

## Summary

`docker compose up -d` brings up the whole stack: Postgres, Chroma, Langflow, Keycloak and the API,
each with a healthcheck. `pnpm env:init` writes `.env` with fresh secrets. The POC's custom Langflow
components and flows move to `langflow/components/` and `flows/`, and Langflow imports the flows on
start. CI checks the compose file and builds the API image.

## Why

Decision 10 (Docker Compose) and the architecture's service list. The POC (`poc/RESULTS.md`) proved the
Langflow 1.13.3 + Chroma 1.5.9 setup; this makes it the real stack.

## Design

```mermaid
flowchart LR
  API[api :3000] --> PG[(postgres)]
  API --> CH[(chroma)]
  API --> LF[langflow :7860]
  API --> KC[keycloak :8081]
  LF --> PG
  KC --> PG
  LF --> CH
  LF -. host.docker.internal:1234 .-> LMS[LM Studio on host]
```

- `docker-compose.yml`: five services sharing a healthcheck pattern; `api` waits (`service_healthy`) for
  postgres, chroma, langflow and keycloak. Published ports bind to `127.0.0.1` only.
- `docker/postgres/init-databases.sh` creates the `langflow` and `keycloak` databases next to `rag` on
  first start.
- Langflow (`langflowai/langflow:1.13.3`) stores its data in Postgres, mounts `langflow/components/`,
  `flows/` (imported via `LANGFLOW_LOAD_FLOWS_PATH`) and the uploads volume read-only, and allows
  `host.docker.internal` past its SSRF guard (POC F3).
- Keycloak (`keycloak/keycloak:26.8.2`, `start --import-realm`) imports `docker/keycloak/realm.json`;
  `KC_HOSTNAME` pins the token issuer to the public URL.
- `docker/api.Dockerfile`: two stages on `node:22.23-alpine`; builds with Turborepo and ships only
  `dist/` and production dependencies (`pnpm deploy`), running as user `node`.
- `scripts/env-init.ts`: copies `.env.example` to `.env`, filling `<generated>` with random secrets and
  a Fernet key for Langflow (POC F4). Never overwrites an existing `.env`.
- CI job "Compose config and API image": `env-init`, `docker compose config --quiet`,
  `docker compose build api`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Langflow data in Postgres | SQLite file (as in the POC) | One database server to back up |
| Keycloak image from Docker Hub | `quay.io/keycloak/keycloak` | Same official image; quay.io was unreachable from the build sandbox |
| Keycloak in `start` mode over HTTP | `start-dev` | Production mode; fine on localhost, needs TLS in front on a network |
| Secrets are `<generated>` placeholders; compose fails without `.env` (`:?run pnpm env:init`) | Working default passwords | No install runs with known passwords |
| Realm imported once from JSON with `${RW_ADMIN_*}` placeholders | Configure via admin API on every start | Simple; later realm changes need the console or `down -v` |
| Flows and components copied unchanged from `poc/` | Rewrite | Proven; renames come later (#14) |

## Interfaces and contracts

- **HTTP API**: none new. Published: api `127.0.0.1:3000`, langflow `127.0.0.1:7860`, keycloak
  `127.0.0.1:8081` (overridable with `API_PORT`, `LANGFLOW_PORT`, `KEYCLOAK_PORT`).
- **Configuration**: `.env` from `.env.example`: `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`,
  `LANGFLOW_SUPERUSER`, `LANGFLOW_SUPERUSER_PASSWORD`, `LANGFLOW_SECRET_KEY` (Fernet), `KEYCLOAK_ADMIN`,
  `KEYCLOAK_ADMIN_PASSWORD`, `RW_ADMIN_USERNAME`, `RW_ADMIN_EMAIL`, `RW_ADMIN_PASSWORD`,
  `KEYCLOAK_PUBLIC_URL`, `ADMIN_UI_URL`, `PUBLIC_API_URL`, `API_PORT`, `LANGFLOW_PORT`, `KEYCLOAK_PORT`,
  `LOG_LEVEL`.
- **Data**: databases `rag`, `langflow`, `keycloak`; volumes `postgres-data`, `chroma-data`,
  `langflow-data`, `uploads`. Keycloak realm `rag-workspaces`: realm role `admin`; public client
  `admin-ui` (code flow + PKCE S256); client `api` (token audience only); 15-minute access tokens;
  password grant off.
- **Langflow**: four flows imported from `flows/` (ingest, retrieve, answer, delete) and the custom
  components in `langflow/components/`. Provider keys never go in Langflow's environment (POC F3).
- **Events and logs**: None.

## Operations

- Hard to undo: database and volume names.
- Realm and Postgres init scripts run on first start only; changes later need the Keycloak console or
  `docker compose down -v` (wipes data).
- The browser reaches Keycloak at `localhost:8081`, the API at `keycloak:8080`; tokens carry the public
  issuer. The auth PR must fetch keys internally and check `iss` against the public URL.
- Port clash on the host (for example a local Langflow on 7860): set `LANGFLOW_PORT` in `.env`.
- Langflow and Keycloak each need 1 to 2 GB of RAM.

## Testing

CI builds the image and validates compose. By hand: `pnpm env:init && docker compose up -d --build`,
`docker compose ps` (five healthy), `curl localhost:3000/ready`, Langflow at http://localhost:7860 lists
the four flows, Keycloak at http://localhost:8081/admin has the `rag-workspaces` realm. Run on Linux
(sandbox) and macOS.

## Out of scope and follow-ups

`/ready` checks for the dependencies (#7, #8). Admin UI service `web` (#9). Whisper profile (M5).

## Docs updated

`README.md`: "Run the stack" with every URL and login.
