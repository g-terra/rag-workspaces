---
title: show the version, the stack's health and links to its tools in the admin UI
date: 2026-11-23
pr: "#103"
status: in review
areas: [admin, infra]
---

# Show the version, the stack's health and links to its tools in the admin UI

## Summary

The admin UI shows the release it was built from under the product name in the sidebar, for everyone who
signs in. Admins get a new **System** page (`/system`, last link of the Admin nav) that shows whether the
stack is healthy: each service the API depends on (Postgres, Chroma, Langflow, Keycloak) with its latency or
error, each model provider (LM Studio, OpenAI, Gemini, Anthropic) with whether it is set up, answers and how
many models it offers, and whether the default chat and embedding models are available. The same page links
to the stack's own tools: the Langflow editor, the Keycloak admin console and the API's Swagger docs.

## Why

The owner asked to "see the version in the app", to "have a place to check health status in the rag
dashboard" and to "have links to the sub tools" (2026-11-23), right after the first release (v0.2.0).
Everything the health view needs already exists: `GET /v1/system`
(`apps/api/src/routes/system.ts`, used by [2026-11-23-admin-workspace-settings.md](2026-11-23-admin-workspace-settings.md))
returns the services, the providers and the defaults, admins only. Until now only the settings page read it, for its
model pickers. The tool URLs were printed once by `pnpm run setup` (`scripts/setup.ts`) and then lost.

## Design

- **Version.** `apps/admin/vite.config.ts` reads the root `package.json` (the version release-please bumps on
  every release, `release-please-config.json`) and defines `__APP_VERSION__` at build time.
  `apps/admin/src/lib/version.ts` exports it as `APP_VERSION`; `components/app-layout.tsx` shows `v0.2.0`
  under the product name. No release-please change is needed, and the admin's own `package.json` version stays
  unused.
- **System page.** `routes/system.tsx`, routed at `/system` in `router.tsx`, linked from the Admin nav in
  `components/app-layout.tsx`.
  Non-admins get the same "Admins only" notice as the API keys page. The page reads `useSystem()`
  (`system/queries.ts`), now refetching every 30 seconds while the page is open, with a Refresh button.
  When a refresh fails, the page shows the error and hides the last result rather than a stale green line.
  `system/health.ts` turns the response into rows: one per service, one per provider (`ok`, `down` or
  `not set up`), one per default model, and an overall line ("All systems working" or "N problems"). The API's
  own version from `/v1/system` is shown next to the UI's, so a stale container is visible.
- **Tool links.** `system/tools.ts` builds the list from build-time URLs: Langflow from `VITE_LANGFLOW_URL`
  (new), Keycloak's admin console from the existing `VITE_KEYCLOAK_URL` (`/admin/master/console/#/rag-workspaces`,
  the realm's users; it signs in as the master realm's `KEYCLOAK_ADMIN`, not the app login, and the link says so), and Swagger at `/api/docs/` on the UI's own origin (nginx already forwards `/api/`, as
  the top bar's "API docs" button does). Links open in a new tab.
- **Build wiring.** `docker/admin.Dockerfile` takes a `LANGFLOW_PUBLIC_URL` build argument (default
  `http://langflow.rag.localhost`) into `VITE_LANGFLOW_URL`, as it already does for Keycloak;
  `docker-compose.yml` passes it; `.env.example` documents it; the smoke stack (`scripts/smoke/stack.ts`)
  sets `http://localhost:17860`, its Langflow port.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Version from the root `package.json` at build time | Read the API's version from `/v1/system`; add `apps/admin/package.json` to release-please's extra files | Shown to every user (`/v1/system` is admins only) and with no request; the root file is the one release-please always bumps, so no config change. |
| Health on its own admin page | A banner in every page; a dot in the sidebar | One place to look, as asked, with room for the error text. A banner polling `/v1/system` on every page would ask four model providers for their lists every few seconds for everyone. |
| Poll every 30 s only while the page is open | Server-sent events; no polling | `/v1/system` already exists and is cheap enough at that rate; nothing new on the API. |
| Tool URLs baked in at build, like Keycloak's | Return public URLs from `/v1/system` | The API only knows the internal Docker names (`http://langflow:7860`); the browser-facing names are a build concern, already handled this way for Keycloak. |
| Swagger through `/api/docs/` | `PUBLIC_API_URL` + `/docs` as another build argument | Same origin always works, through Caddy names or plain ports, and needs no new setting. |

## Interfaces and contracts

- **HTTP API**: None. The page reads the existing `GET /v1/system`.
- **Configuration**: `LANGFLOW_PUBLIC_URL` (default `http://langflow.rag.localhost`): Langflow as the browser
  sees it, passed to the admin image as a build argument (`VITE_LANGFLOW_URL`). Changing it needs
  `docker compose build web`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

An existing install picks the version and the page up on the next `docker compose up --build`. Set
`LANGFLOW_PUBLIC_URL` only when Langflow is not at `http://langflow.rag.localhost` (another `PROXY_PORT`, or
`http://localhost:7860` without the proxy). Nothing is hard to undo.

## Testing

- `apps/admin/src/system/health.test.ts`: services, providers (configured, reachable, not set up) and default
  models become the right rows and the right overall line, including a failing service with its error.
- `apps/admin/src/system/tools.test.ts`: the links come from the given URLs, trailing slashes are handled,
  and the Keycloak console points at the `rag-workspaces` realm.
- `apps/admin/e2e/system.spec.ts`: an admin opens System from the sidebar, sees the services and the tool
  links, and the sidebar shows the version.
- By hand: `pnpm run setup`, open `http://rag.localhost/system`, stop Langflow (`docker compose stop
  langflow`), press Refresh: Langflow turns red with its error; start it again.

## Out of scope and follow-ups

- No health for the proxy (Caddy) or the admin UI's nginx: the browser reaching the page already shows them up.
- No history or alerting; this is the state now.
- The Keycloak login theme is a separate change.

## Docs updated

- `README.md`: the System page in the admin UI tour.
- `docs/setup.md`: the System page as the first place to look, and `LANGFLOW_PUBLIC_URL` with `PROXY_PORT`.
- `.env.example`: `LANGFLOW_PUBLIC_URL`.
