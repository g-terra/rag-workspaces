# rag-workspaces

A self-hosted RAG platform built on Langflow. You create **workspaces** (for example `ouc` for study material, `personal` for your own notes), load files into each one, and every workspace gets its own isolated, documented API that people and AI agents can query.

Material is loaded locally (PDF, DOCX, TXT, MD, and optionally video via Whisper), indexed into ChromaDB through Langflow flows, and served through a REST API with Swagger docs, Keycloak login, workspace-scoped API keys, usage analytics, and an admin UI with drag-and-drop upload and live progress.

The first workspace, `ouc`, is the project for the COS512 Langflow assignment (Option 4: expose AI interactions via an API).

> Status: the backend is built (workspaces, ingestion, search, answers, chat, folders, analytics, API keys,
> rate limits, an MCP server); the admin UI screens are being built (M4). Video (M5) is not built yet.

The assignment brief's example endpoints map to these routes (no aliases, decision 6):

| Brief | Route |
|---|---|
| `/ask` | `POST /v1/workspaces/{slug}/answers` |
| `/chat` | `POST /v1/workspaces/{slug}/conversations/{id}/messages` |
| `/retrieve` | `GET /v1/workspaces/{slug}/passages?query=…` |
| Usage analytics | `GET /v1/usage/…` and `GET /v1/workspaces/{slug}/usage/…` |

- [Setup](docs/setup.md): from a clone to a first answer, models, people, troubleshooting
- [Using the API](docs/api.md): authentication and examples for scripts and agents
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

The step-by-step guide, with model setup and troubleshooting, is [docs/setup.md](docs/setup.md). Examples
for scripts and agents calling the API are in [docs/api.md](docs/api.md).


Requirements: Docker with Compose, about 6 GB of free RAM for the containers, and LM Studio on the host (from M1).

```bash
pnpm install
pnpm run setup           # checks the machine, writes .env, picks the models, starts the stack
```

`pnpm run setup` asks a few questions and can be run again at any time; it keeps your secrets (`--yes` takes
the defaults without asking). By hand, the same is:

```bash
pnpm env:init            # once: writes .env with fresh random secrets (or: node scripts/env-init.ts)
docker compose up -d     # first start pulls about 2 GB of images and takes a few minutes
docker compose ps        # every service should say (healthy)
```

| What | Where | Also at | Login |
|---|---|---|---|
| Admin UI | http://rag.localhost | http://localhost:8080 | `RW_ADMIN_USERNAME` / `RW_ADMIN_PASSWORD`, through Keycloak's sign-in page |
| API and Swagger UI | http://api.rag.localhost/docs | http://localhost:3000/docs | a Keycloak token or an `rw_` API key |
| Langflow editor | http://langflow.rag.localhost | http://localhost:7860 | `LANGFLOW_SUPERUSER` / `LANGFLOW_SUPERUSER_PASSWORD` from `.env` |
| Keycloak admin console (create people here) | http://auth.rag.localhost/admin | http://localhost:8081/admin | `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` |
| rag-workspaces sign-in (realm `rag-workspaces`) | http://auth.rag.localhost/realms/rag-workspaces/account | | `RW_ADMIN_USERNAME` / `RW_ADMIN_PASSWORD` |

The names come from a small proxy (Caddy, `docker/caddy/Caddyfile`) on port 80, over plain HTTP. Chrome, Firefox
and Edge send every `*.localhost` name to this machine by themselves, so there is nothing to set up. If a
browser or tool doesn't open them (some Safari versions, older curl), add this line to `/etc/hosts`:

```text
127.0.0.1 rag.localhost api.rag.localhost auth.rag.localhost langflow.rag.localhost
```

If port 80 is taken, set `PROXY_PORT` in `.env` (for example `8088`) and add the port to `KEYCLOAK_PUBLIC_URL`,
`ADMIN_UI_URL` and `PUBLIC_API_URL` (`http://rag.localhost:8088`), then `docker compose up -d --build`. The
"Also at" ports keep working either way; Keycloak's pages always show at `KEYCLOAK_PUBLIC_URL`.

After signing in, the admin UI opens the workspace you used last (or your first one); the workspace
switcher in the sidebar changes it. Admins create workspaces from "All workspaces" or the switcher. Editors
and admins upload files from "Upload" in the sidebar and watch each one through ingestion live.
"Documents" lists everything in the workspace, live, with download for everyone and reindex and delete for
editors and admins. Admins manage API keys for agents and scripts under "API keys": a new key's secret is
shown once, with a `curl` example to try it. "Usage" charts requests, latency, top questions, cited
documents and the raw request log — for one workspace (editors and admins) or across all of them
(admins). The API docs are linked from the top bar of every page.

`docker compose down` stops everything and keeps your data; `docker compose down -v` also deletes it.

### Updating an existing install

Run `pnpm env:init` after pulling: it adds any new secret to your `.env` and leaves the rest alone. Keycloak
imports `docker/keycloak/realm.json` only into an empty database, so a realm created before a change to that
file keeps its old settings. The simplest fix on a test install is `docker compose down -v` (this deletes
the stack's data) and `docker compose up -d --build`. To keep your data instead, make the change by hand in
the Keycloak admin console; for the people list (`GET /v1/users`, added 2026-11-23) that means creating the
`api-directory` client as `realm.json` describes it, with `KEYCLOAK_DIRECTORY_SECRET` from `.env` as its
secret.

An install from before the local names (2026-11-23) keeps its `localhost` URLs, because `pnpm env:init`
never changes existing values, and keeps working as before. To move it to the names:

1. In `.env`, set `KEYCLOAK_PUBLIC_URL=http://auth.rag.localhost`, `ADMIN_UI_URL=http://rag.localhost` and
   `PUBLIC_API_URL=http://api.rag.localhost`.
2. In the Keycloak admin console (realm `rag-workspaces`, client `admin-ui`), add `http://rag.localhost/*` to
   the valid redirect URIs and post-logout redirect URIs, and `http://rag.localhost` to the web origins.
3. Run `docker compose up -d --build` (the admin UI has the Keycloak URL built in).

## Connect an agent (MCP)

`apps/mcp` is an [MCP](https://modelcontextprotocol.io) server, so Claude Desktop, Claude Code or any MCP
client can search and ask a workspace. It runs on your machine over stdio and calls the REST API with an
API key, so the key's role and workspaces decide what the agent sees. Its tools: `list_workspaces`,
`list_folders`, `list_documents`, `search_passages`, `read_passage` and `ask`. None of them changes any
material; `ask` stores an answer, like any other caller's.

1. In the admin UI, "API keys", create a `reader` key for the workspaces the agent may use, and copy it.
2. Build the server once: `pnpm install && pnpm --filter '@rag/mcp...' build`.
3. Add it to your client. Claude Code:

   ```bash
   claude mcp add rag-workspaces --env RW_API_KEY=rw_... --env RW_API_URL=http://localhost:3000 \
     -- node "$PWD/apps/mcp/dist/main.js"
   ```

   Claude Desktop (`claude_desktop_config.json`, use the full path to your clone):

   ```json
   {
     "mcpServers": {
       "rag-workspaces": {
         "command": "node",
         "args": ["/path/to/rag-workspaces/apps/mcp/dist/main.js"],
         "env": { "RW_API_KEY": "rw_...", "RW_API_URL": "http://localhost:3000" }
       }
     }
   }
   ```

`RW_API_URL` defaults to `http://localhost:3000`, the API's own port; `http://api.rag.localhost` works too. Tool calls count toward the key's rate limits, and an API
error (a wrong workspace, a `429`) comes back to the agent as a tool error with the API's reason.

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
| `apps/mcp` | MCP server over stdio for agents (see "Connect an agent"); tests run it against a fake API |
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
