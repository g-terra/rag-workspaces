---
title: Fastify API skeleton with shared config and zod schemas, Swagger UI, health and readiness
date: 2026-11-20
pr: '#5'
status: merged
areas: [api]
---

# Fastify API skeleton with shared config and zod schemas, Swagger UI, health and readiness

## Summary

Adds `apps/api`, the Fastify app every later backend PR adds routes to, and two packages it needs:
`packages/config` (shared TypeScript, ESLint and Vitest settings) and `packages/shared` (the API contract
as zod schemas). The API serves `GET /health`, `GET /ready`, its OpenAPI spec at `/openapi.json` and
Swagger UI at `/docs`. Every error is RFC 9457 problem JSON.

## Why

Decisions 1 and 10: TypeScript with Fastify + zod gives typed validation and a generated OpenAPI spec
(the "same capability as FastAPI" argument in `docs/decisions.md`). The assignment asks for documented
endpoints.

## Design

- `apps/api/src/config.ts`: reads environment variables once at startup with zod. A missing or
  malformed value stops the process with a readable list of problems.
- `apps/api/src/app.ts`: `buildApp({ config, checks, logger })` creates Fastify with
  `fastify-type-provider-zod`, `@fastify/swagger` + Swagger UI, request ids and the error handler. It
  takes its dependencies as arguments, so tests build the app in memory without globals or a port.
- `apps/api/src/routes/health.ts`: `/health` (process is up) and `/ready` (runs every readiness check).
- `apps/api/src/readiness.ts`: `runChecks()` runs named checks in parallel, each with
  `READY_TIMEOUT_MS`, and returns `{ name, ok, latencyMs, error? }` per check. The list is empty here;
  later PRs register Postgres, Chroma, Langflow and Keycloak.
- `apps/api/src/errors.ts`: maps every error to `application/problem+json`. 5xx bodies never contain the
  internal message; the `X-Request-Id` points to the log line.
- `apps/api/src/main.ts`: loads config, builds the app, listens, and closes cleanly on SIGINT/SIGTERM.
- `packages/shared/src/common.ts`: `Problem`, `Health`, `Ready` schemas. Packages compile to `dist/` and
  are imported as built JavaScript.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| zod schemas on every route are the source of truth | Hand-written OpenAPI, TypeBox | One definition validates input, serialises output (unknown fields dropped) and generates docs |
| Packages are built to `dist/` | Import TypeScript source | Node runs the result in Docker with no TS loader; costs one build step |
| Strict TS incl. `noUncheckedIndexedAccess`, `verbatimModuleSyntax` | Default strictness | Cheap to relax later, painful to tighten |
| TypeScript 5.9.3 | TS 7 | `typescript-eslint` did not support TS 7 yet |
| `/ready` returns only `{status}` | Per-dependency detail | It is unauthenticated; admins get detail from `GET /v1/system` later |
| Keep a caller's `X-Request-Id` | Always generate | Lets clients correlate logs; no security impact |

## Interfaces and contracts

- **HTTP API**: `GET /health` → 200 `{"status":"ok"}`. `GET /ready` → 200 `{"status":"ok"}` or 503
  `{"status":"unavailable"}`. `GET /openapi.json`, `GET /docs`. Errors: RFC 9457 problem JSON with
  `type`, `title`, `status`, `detail`, `instance`. Every response has `X-Request-Id`.
- **Configuration**: `NODE_ENV` (development), `HOST` (0.0.0.0), `PORT` (3000), `LOG_LEVEL` (info),
  `PUBLIC_API_URL` (http://localhost:3000, the server in the OpenAPI spec), `READY_TIMEOUT_MS` (3000).
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: pino JSON logs with the request id; `pino-pretty` in development.

## Operations

Nothing hard to undo. Known leftovers to tidy in a follow-up: the root `typescript` devDependency is not
needed, and the OpenAPI description and `/ready` description mention auth and dependencies that arrive
in later PRs.

## Testing

`apps/api/src/app.test.ts` uses `app.inject()`: health with a request id, a caller's request id kept,
`/ready` with passing, failing and hanging checks (503 without detail), the OpenAPI spec and Swagger UI,
problem JSON for unknown routes, and a readable error for a bad `PORT`.
By hand: `pnpm install && pnpm build && pnpm --filter @rag/api dev`, then open
http://localhost:3000/docs and `curl -i localhost:3000/health`.

## Out of scope and follow-ups

Readiness checks for real dependencies (Langflow, Chroma, Keycloak: #7; Postgres: #8). Auth (#11).

## Docs updated

None needed: `docs/api-schema.md` already described `/health`, `/ready` and problem JSON.
