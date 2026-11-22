---
title: Admin UI shell with Vite, React, Tailwind and shadcn/ui, served by nginx
date: 2026-11-20
pr: '#9'
status: in review
areas: [admin, infra, ci]
---

# Admin UI shell with Vite, React, Tailwind and shadcn/ui, served by nginx

## Summary

Adds `apps/admin`, an empty but working admin app (Vite 8, React 19, Tailwind CSS 4, shadcn/ui) and a
`web` compose service that serves it with nginx on `127.0.0.1:8080`. One placeholder page shows the
API's readiness. The UI always calls `/api/...` on its own origin, and nginx forwards that to the API.

## Why

Decision 10 (Tailwind + shadcn/ui) and the M0 milestone: the frontend work needs a running app to build
the approved design mocks into.

## Design

- `apps/admin/vite.config.ts`: `@/` alias; dev server proxies `/api` to `localhost:3000`, stripping the
  prefix.
- `apps/admin/src/App.tsx`: placeholder page calling `/api/ready`; `main.tsx` follows the system
  light/dark setting.
- shadcn/ui copied in: `components.json`, `src/lib/utils.ts` (`cn()`), `src/components/ui/button.tsx`,
  theme tokens in `src/index.css`.
- `docker/admin.Dockerfile`: builds static files, serves them with `nginx:1.30.7-alpine`.
- `docker/admin/nginx.conf`: SPA fallback to `index.html`, long cache for hashed assets, `/api/`
  proxied to `api:3000` with buffering off (for server-sent events).
- `docker-compose.yml`: `web` service; CI builds its image.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Same-origin `/api` proxy | CORS on the API, API URL in the UI build | No CORS config; the UI never needs the API's URL |
| Vite SPA + nginx | Next.js | Supporting choices table: static build, no server runtime |
| shadcn/ui copied in | A component library dependency | Components are ours to edit |
| Routing, data fetching, login, API client left out | Add them now | Rule 1; they belong to the frontend milestone |

## Interfaces and contracts

- **HTTP API**: the UI's contract is the `/api` prefix; nginx strips it, so the API keeps `/v1/...`.
- **Configuration**: none new; `web` publishes `127.0.0.1:8080`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Known gap: Swagger UI opened at `localhost:8080/api/docs` sends "Try it out" requests to
`localhost:3000`, which is cross-origin there; use `localhost:3000/docs`. Nothing hard to undo.

## Testing

`apps/admin/src/lib/utils.test.ts` (the `cn()` helper). By hand: `docker compose up -d --build`, open
http://localhost:8080 ("API status: Ready"), http://localhost:8080/api/docs/, and a deep link such as
`/workspaces/ouc`; or `pnpm --filter @rag/admin dev` for hot reload.

## Out of scope and follow-ups

The real screens, design tokens, React Router, TanStack Query, Keycloak login and generated API client
(frontend milestone M4).

## Docs updated

`README.md` (admin URL), `.env.example`.
