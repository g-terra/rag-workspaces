---
title: local names for the stack (rag.localhost) through a Caddy proxy
date: 2026-11-23
pr: "#47"
status: in review
areas: [infra, docs]
---

# Local names for the stack (rag.localhost) through a Caddy proxy

## Summary

A new `proxy` service (Caddy) gives the stack names instead of ports:

- `http://rag.localhost`: the admin UI
- `http://api.rag.localhost`: the API and Swagger
- `http://auth.rag.localhost`: Keycloak
- `http://langflow.rag.localhost`: Langflow

New installs use the names as their public URLs, and Keycloak issues tokens as `auth.rag.localhost`. The
old ports (8080, 3000, 8081, 7860) keep working, and signing in from `http://localhost:8080` still works.
Existing installs change only if their owner switches the URLs in `.env`.

## Why

Guilherme asked for local names, and approved them on 2026-11-23 (docs/decisions.md #22). Four port
numbers are hard to remember and to show in the demo video. Browsers resolve `*.localhost` to the
machine by themselves (RFC 6761), so names cost no setup.

## Design

1. **`docker/caddy/Caddyfile`**: one site per name, each a `reverse_proxy` to the service's port on the
   compose network.
   - `auto_https off` and `admin off`.
   - A catch-all `:80` site answers `/healthz` for the healthcheck, and gives a 404 naming the right
     addresses for anything else.
   - Caddy streams `text/event-stream` responses without buffering by default, so SSE (answers, document
     status) works through it.
2. **`docker-compose.yml`**:
   - The `proxy` service (`caddy:2.10.2-alpine`) listens on `127.0.0.1:${PROXY_PORT:-80}`.
   - The defaults for `KEYCLOAK_PUBLIC_URL`, `ADMIN_UI_URL` and `PUBLIC_API_URL` switch to the names, and
     so does the admin image's `KEYCLOAK_PUBLIC_URL` build arg (`docker/admin.Dockerfile`).
   - Keycloak gets `RW_ADMIN_UI_FALLBACK_URL: http://localhost:${WEB_PORT:-8080}`.
3. **`docker/keycloak/realm.json`**: the `admin-ui` client also accepts `${RW_ADMIN_UI_FALLBACK_URL}` in
   its redirect URIs, web origins and post-logout redirects. That is why `http://localhost:8080` keeps
   working for sign-in.
4. **`.env.example`**: the three URLs use the names, plus a new `PROXY_PORT=80` with a note on adding the
   port to the URLs when it isn't 80.
5. **Smoke test** (`scripts/smoke/stack.ts`, `check.ts`):
   - The smoke stack sets `PROXY_PORT=18088`.
   - A new first step connects to `127.0.0.1:18088` with each name as the `Host` header. It checks the
     admin UI's HTML, the API's `/health`, Keycloak's discovery document and Langflow's `/health_check`.
     Node doesn't resolve `*.localhost` on every system, and this avoids depending on it.
   - The smoke and e2e stacks keep their `localhost` URLs, so the Playwright tests are unchanged.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Plain HTTP | HTTPS with Caddy's local CA | Browsers treat `localhost` names as secure contexts, so PKCE sign-in and cookies work. A local CA needs a trust step on every machine and in CI |
| `*.rag.localhost` | `*.rag.test` or `.local` | Only `.localhost` resolves with no hosts file or DNS. `.local` is mDNS and slow on macOS |
| Caddy | nginx (already used inside the admin image), Traefik | A four-site config with streaming handled by default. Traefik needs the Docker socket |
| Keep the direct ports published | Only the proxy | Scripts, the Vite dev server, the smoke tests and the e2e tests use them, and they keep working if port 80 is taken |
| Names are only the default for new installs | Rewrite existing `.env` files | `pnpm env:init` never changes existing values. A realm that was already imported would refuse the new redirect URI, so switching is a documented manual step |
| Smoke checks the routing with a `Host` header | Switch the smoke stack's issuer to the names | Node can't resolve `*.localhost` in every CI image. Sign-in over the names was checked by hand in Chromium (see Testing) |

## Interfaces and contracts

- **HTTP API**: None. The same routes are also reachable at `http://api.rag.localhost`.
- **Configuration**:
  - `PROXY_PORT` (new): default `80`.
  - New defaults: `KEYCLOAK_PUBLIC_URL=http://auth.rag.localhost`, `ADMIN_UI_URL=http://rag.localhost`
    and `PUBLIC_API_URL=http://api.rag.localhost`.
  - Realm placeholder `RW_ADMIN_UI_FALLBACK_URL`, set by compose from `WEB_PORT`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

- **New installs**: nothing to do. Port 80 on 127.0.0.1 must be free; if it isn't, set `PROXY_PORT`, add
  the port to the three URLs, and run `docker compose up -d --build`.
- **Existing installs** keep their `localhost` URLs and work as before. The proxy starts too, but the
  names only work for Langflow and the API until the URLs and Keycloak's redirect URIs are switched. The
  README's "Updating an existing install" gives the three steps.
- **Safari and older curl** may not resolve `*.localhost`. The README gives the `/etc/hosts` line.
- **Undoing it** means setting the URLs back to the `localhost` ports. The realm still accepts both.

## Testing

- `pnpm smoke`: the new "local names" step passes, and so does every other step (run locally).
- By hand, with the smoke stack's URLs switched to `*.rag.localhost:18088` and the admin image rebuilt with
  that Keycloak URL: Chromium signed in at `http://rag.localhost:18088` and at the fallback
  `http://localhost:18080`. Both went through Keycloak at `auth.rag.localhost:18088` and loaded
  `/api/v1/me` and `/api/v1/workspaces` with `200`.
- To try it yourself: `docker compose up -d`, then open `http://rag.localhost`.

## Out of scope and follow-ups

- HTTPS, and names reachable from other machines on the network.
- The `pnpm setup` wizard (docs/specs/2026-11-22-setup-cli-plan.md) can check that port 80 is free and
  pick `PROXY_PORT` for the user.

## Docs updated

- `README.md`: URL table with the names and the fallback ports, the hosts-file note, `PROXY_PORT`, and
  how to switch an existing install.
- `docs/architecture.md`: published ports and the easy-start URLs.
- `docs/decisions.md`: decision 22.
