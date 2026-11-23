# rag-workspaces

A self-hosted RAG platform built on Langflow. You create **workspaces** (for example `ouc` for study material, `personal` for your own notes), load files into each one, and every workspace gets its own isolated, documented API that people and AI agents can query.

Material is loaded locally (PDF, DOCX, TXT, MD, and optionally video via Whisper), indexed into ChromaDB through Langflow flows, and served through a REST API with Swagger docs, Keycloak login, workspace-scoped API keys, usage analytics, and an admin UI with drag-and-drop upload and live progress.

The first workspace, `ouc`, is the project for the COS512 Langflow assignment (Option 4: expose AI interactions via an API).

> Status: **building milestone M0** (scaffold). The plan is in `docs/`, the Langflow proof of concept in `poc/`.

- [Architecture](docs/architecture.md): components, workspaces, data flow, repo layout
- [API schema](docs/api-schema.md): resources, routes and shapes
- [Work breakdown](docs/work-breakdown.md): milestones and the four workstreams
- [Decisions](docs/decisions.md): what is settled, what is open, and why

## Commits and releases

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`,
for example `feat(api): stream answers` or `fix(admin): keep the upload list sorted`. `pnpm install` sets up a
Git hook that checks each message, and CI checks pull request commits and titles. Types: `feat`, `fix`,
`perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`; add `!` (`feat(api)!: …`) for a
breaking change.

Versions follow [semantic versioning](https://semver.org) and are picked from those messages by
[release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`):

1. Every push to `main` updates a release pull request (`chore(main): release x.y.z`) with the next version
   and `CHANGELOG.md`. `fix` bumps the patch version; `feat` and breaking changes bump the minor version
   while we are below 1.0.
2. Merging it tags `vX.Y.Z`, creates the GitHub release, sets that version in the API's `package.json` (shown
   in Swagger), and publishes `ghcr.io/g-terra/rag-workspaces-api` and `-admin` tagged `X.Y.Z`,
   `X.Y` and `latest`.

## Run the stack

Requirements: Docker with Compose, about 6 GB of free RAM for the containers, and LM Studio on the host (from M1).

```bash
pnpm env:init            # once: writes .env with fresh random secrets (or: node scripts/env-init.ts)
docker compose up -d     # first start pulls about 2 GB of images and takes a few minutes
docker compose ps        # every service should say (healthy)
```

| What | Where | Login |
|---|---|---|
| Admin UI | http://localhost:8080 | `RW_ADMIN_USERNAME` / `RW_ADMIN_PASSWORD`, through Keycloak's sign-in page |
| API and Swagger UI | http://localhost:3000/docs | none yet |
| Langflow editor | http://localhost:7860 | `LANGFLOW_SUPERUSER` / `LANGFLOW_SUPERUSER_PASSWORD` from `.env` |
| Keycloak admin console (create people here) | http://localhost:8081/admin | `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` |
| rag-workspaces sign-in (realm `rag-workspaces`) | http://localhost:8081/realms/rag-workspaces/account | `RW_ADMIN_USERNAME` / `RW_ADMIN_PASSWORD` |

After signing in, the admin UI opens the workspace you used last (or your first one); the workspace
switcher in the sidebar changes it. Admins create workspaces from "All workspaces" or the switcher. Editors
and admins upload files from "Upload" in the sidebar and watch each one through ingestion live.
"Documents" lists everything in the workspace, live, with download for everyone and reindex and delete for
editors and admins. Admins manage API keys for agents and scripts under "API keys": a new key's secret is
shown once, with a `curl` example to try it. "Usage" charts requests, latency, top questions, cited
documents and the raw request log — for one workspace (editors and admins) or across all of them
(admins). "Settings" (admins) changes a workspace's name, description, chat model and retrieval
settings, with the providers and models read from `GET /v1/system`; it is also where you grant and
remove other people's access to the workspace, start a reindex (the only way to change the embedding
model) and delete the workspace. The API docs are linked from the top bar of every page.

`docker compose down` stops everything and keeps your data; `docker compose down -v` also deletes it.

### Updating an existing install

Run `pnpm env:init` after pulling: it adds any new secret to your `.env` and leaves the rest alone. Keycloak
imports `docker/keycloak/realm.json` only into an empty database, so a realm created before a change to that
file keeps its old settings. The simplest fix on a test install is `docker compose down -v` (this deletes
the stack's data) and `docker compose up -d --build`. To keep your data instead, make the change by hand in
the Keycloak admin console; for the people list (`GET /v1/users`, added 2026-11-23) that means creating the
`api-directory` client as `realm.json` describes it, with `KEYCLOAK_DIRECTORY_SECRET` from `.env` as its
secret.

## Development

Requirements: Node 22.18+ and pnpm 10 (`corepack enable` gives you the pinned version).

```bash
pnpm install
pnpm build       # build every package (Turborepo caches the results)
pnpm test        # Vitest in every package (database tests run when TEST_DATABASE_URL is set)
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm format      # Prettier
pnpm smoke       # end to end on a throwaway compose stack with a stand-in model (needs Docker)
pnpm e2e         # the admin UI's Playwright tests on that same throwaway stack (needs Docker)
```

End-to-end tests drive the admin UI in a real browser. `pnpm e2e` starts the throwaway smoke stack, runs
them against it and removes it again (`--keep` leaves it running; other arguments go to Playwright, e.g.
`pnpm e2e upload.spec.ts`). CI runs the same command on pull requests that touch the admin UI or the stack.
To run them against your own running stack instead (`docker compose up -d --build` first), where they sign
in as the seeded admin from `.env` and create and delete their own workspaces:

```bash
pnpm --filter @rag/admin exec playwright install chromium   # once
pnpm e2e                                                    # on the throwaway smoke stack
set -a; source .env; set +a                                 # or: RW_ADMIN_USERNAME / RW_ADMIN_PASSWORD
pnpm --filter @rag/admin e2e                                #     against your own stack
```

| Path | What it is |
|---|---|
| `apps/admin` | Admin UI (Vite + React + Tailwind + shadcn/ui), Keycloak sign-in; Playwright tests in `e2e/`: `pnpm --filter @rag/admin dev` (http://localhost:5173, forwards `/api` to the API) |
| `apps/api` | Fastify API: `pnpm --filter @rag/api dev`, then Swagger UI at http://localhost:3000/docs |
| `packages/config` | Shared TypeScript, ESLint and Vitest settings |
| `packages/db` | Drizzle schema, SQL migrations (`drizzle/`) and the Postgres connection. Migrations run when the API starts |
| `scripts/smoke` | The compose smoke test: `stack.ts up` and `down` run the stack as project `rag-workspaces-smoke` with `docker-compose.smoke.yml`, `check.ts` the checks, `e2e.ts` the admin UI's Playwright tests on the same stack (`pnpm e2e`) |
| `packages/langflow-client` | Typed client for Langflow's login, API key, flow and run/stream endpoints |
| `packages/shared` | zod schemas shared by the API and the admin UI (the API contract) |
| `docker-compose.yml`, `docker/` | The stack, the API image, the Postgres init script and the Keycloak realm |
| `langflow/components/` | Custom Langflow components (Python, run inside Langflow), from the POC |
| `flows/` | Langflow flows, imported on every Langflow start |
| `poc/` | The Langflow proof of concept (see `poc/RESULTS.md`) |

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, tests and build on every pull request.
