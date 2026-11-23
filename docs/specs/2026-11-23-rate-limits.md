---
title: rate limits per person and per API key
date: 2026-11-23
pr: "#48"
status: in review
areas: [api, infra, docs]
---

# Rate limits per person and per API key

## Summary

Each person and each API key may make 600 `/v1` requests a minute. Of those, 30 may run a model:
passage search, answers and chat messages. Every response carries `RateLimit-Limit`,
`RateLimit-Remaining` and `RateLimit-Reset`. A caller over a limit gets `429` with `Retry-After` and a
problem body that says which limit it hit and when to try again. Both numbers are set in `.env`, and `0`
turns a limit off.

## Why

docs/architecture.md ("Rate limits") and docs/work-breakdown.md (M1 item 4) plan them, and
docs/api-schema.md lists them under conventions. The point is that one looping agent with an API key can't
starve the one local model that everyone in every workspace shares.

## Design

1. **`apps/api/src/rate-limit.ts`**: a Fastify plugin registered right after `auth` in `app.ts`, so the
   principal is known.
   - Its `onRequest` hook takes the key `user:<id>` or `key:<id>`.
   - It counts the request in a `FixedWindow` (one-minute windows in a `Map`, pruned when it grows past
     10,000 keys).
   - When the route is marked `config: { modelCall: true }`, it also counts the request in a second
     window.
2. **Headers**: the plugin sets the `RateLimit-*` headers of the window with fewer requests left, or of
   the one that was exceeded. Over a limit it throws an `HttpProblem(429)` with `Retry-After`, and the
   error handler turns that into problem JSON as usual.
3. **What is skipped**:
   - Anonymous requests: they get `401` from the route before costing anything, and behind the proxies
     every anonymous caller shares one IP.
   - Routes outside `/v1` (`/health`, `/ready`, `/docs`).
4. **Model routes**: `config.modelCall` is set on `GET .../passages` (search), `POST .../answers` and
   `POST .../conversations/{id}/messages`.
5. **Configuration**: `RATE_LIMIT_PER_MINUTE` and `RATE_LIMIT_MODEL_PER_MINUTE` in `apps/api/src/config.ts`,
   passed through `docker-compose.yml` and documented in `.env.example`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A small limiter of our own (about 100 lines) | `@fastify/rate-limit`, which docs/architecture.md named | The plugin gives a route with its own limit a separate store, so the model limit couldn't be shared across the three model routes (`groupId` doesn't help with the local store), and those routes would stop counting toward the overall limit |
| In memory | Postgres or Redis | There is one API process per Langflow already (docs/architecture.md, Langflow API key). A restart resets the counts, which is harmless |
| Fixed one-minute windows | Sliding window or token bucket | Easy to explain in `Retry-After` and the headers. A burst of 2 × limit across a window edge is acceptable at these sizes |
| 600 and 30 a minute | Lower | The admin UI alone makes several requests per page. A local model answers maybe one question every few seconds, so 30 model calls a minute is already more than it can serve. An admin can raise or turn off either limit |
| Admins are limited too | Exempt admins | A script run with an admin's token can loop like anyone else's |
| Draft `RateLimit-*` headers, one set | The newer combined `RateLimit` / `RateLimit-Policy` headers | What docs/api-schema.md promised, and what most clients read |

## Interfaces and contracts

- **HTTP API**:
  - Every `/v1` response to a signed-in caller has `RateLimit-Limit`, `RateLimit-Remaining` and
    `RateLimit-Reset` (seconds until the window resets).
  - A caller over a limit gets `429`, `Retry-After: <seconds>`, and a problem `detail` such as
    "Too many searches, answers and chat messages: the limit is 30 a minute. Try again in 12 s.".
- **Configuration**: `RATE_LIMIT_PER_MINUTE` (default `600`) and `RATE_LIMIT_MODEL_PER_MINUTE` (default
  `30`). `0` turns that limit off.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: `429` responses go to the usage log like any other response.

## Operations

Nothing to do on upgrade: the defaults apply. To give one heavy agent more room, raise the numbers in
`.env` and run `docker compose up -d api`. Limits are per API process, and the counts reset when the
process restarts.

## Testing

- `apps/api/src/rate-limit.test.ts`:
  - A window counts per key and resets after a minute.
  - Each caller is limited separately, with the headers, a `429` problem and the right `Retry-After`.
  - Model calls hit their tighter limit and still count toward the overall one.
  - Anonymous requests, `/health` and a limit of `0` are left alone.
- The rest of the API suite still passes with the default limits.
- `scripts/smoke/check.ts`: `GET /v1/me` carries `RateLimit-Limit: 600` on the real stack.

To check by hand: run `for i in $(seq 31); do curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $KEY" 'http://localhost:3000/v1/workspaces/ouc/passages?query=x'; done`.
The last request answers `429`.

## Out of scope and follow-ups

- Per-workspace or per-key custom limits.
- Showing a key's remaining budget in the admin UI.

## Docs updated

- `docs/api-schema.md`: the conventions row and the `429` row.
- `docs/architecture.md`: status table, "Rate limits" and the tech table (no `@fastify/rate-limit`).
- `.env.example`: the two settings.
