---
title: Handle EACCES on privileged ports in pnpm run setup
date: 2026-11-23
pr: "#65"
status: in review
areas: [infra]
---

# Handle `EACCES` on privileged ports in `pnpm run setup`

## Summary

`pnpm run setup` (`scripts/setup.ts`) checks that `PROXY_PORT` (default `80`) and the other published ports
are free before starting Docker Compose. On macOS and Linux, trying to bind port `80` from a non-root Node
process fails with `EACCES` even when nothing is listening and Docker can publish the port. The port check
moves into `scripts/setup/ports.ts` and falls back to a short TCP connect probe on `EACCES`: `ECONNREFUSED`
means nothing is listening (free), while a successful connection means the port is in use.

## Why

Found during the first live run of `pnpm run setup` on macOS after PR #53 (`2026-11-23-setup-wizard.md`):
`80 (PROXY_PORT) is in use` halted the wizard before the interactive model prompts even though
`sudo lsof -nP -iTCP:80 -sTCP:LISTEN` showed nothing listening. Non-root Node gets `EACCES` on ports below
1024, and the previous `portFree()` treated every `server` error as "in use".

## Design

1. **Helper module** (`scripts/setup/ports.ts`). Exports `portFree(port, options?)`:
   - First tries `net.createServer().listen(port, '127.0.0.1')` (matching the `127.0.0.1` bind in
     `docker-compose.yml`).
   - If listening succeeds, closes the server and resolves `true`.
   - If it fails with `EACCES`, falls back to a TCP connect probe (`net.createConnection({ host: '127.0.0.1', port })` with a 500 ms timeout):
     - `ECONNREFUSED` resolves `true` (nothing is listening on `127.0.0.1:<port>`).
     - `connect`, `timeout`, or any other socket error resolves `false` (taken or unreachable).
   - Any other listen error (including `EADDRINUSE`) resolves `false`.
2. **Caller** (`scripts/setup.ts`). Imports `portFree` from `./setup/ports.ts` and drops the inline
   `createServer` check.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Fall back to a TCP connect probe on `EACCES` | Skip checking ports `< 1024`; shell out to `lsof` | Skipping would miss a real service on port 80; non-root `lsof` cannot see root-owned listeners on macOS/Linux, whereas a TCP connect probe detects any listener regardless of owner |
| Treat `timeout` and non-`ECONNREFUSED` probe errors as taken (`false`) | Treat them as free | Conservative: only `ECONNREFUSED` proves nothing is listening on loopback |
| Extract `scripts/setup/ports.ts` with optional `listen`/`probe` hooks | Keep inline in `scripts/setup.ts` | Matches `scripts/setup/env-file.ts` and lets `node:test` test the `EACCES` branch deterministically whether tests run as root or non-root |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. No upgrade steps; `pnpm run setup` immediately works on default `PROXY_PORT=80` without root.

## Testing

- `scripts/setup/ports.test.ts` (`pnpm test:scripts`):
  - returns `true` for a genuinely free loopback port;
  - returns `false` for a port with a listener on `127.0.0.1`;
  - when `listen` returns `'eacces'`, probes the real loopback port and returns `true` when nothing is
    listening (`ECONNREFUSED`) and `false` when a server is listening;
  - returns `false` on non-`EACCES` listen errors (`'in-use'`).
- By hand: run `pnpm run setup` on a machine where nothing listens on port `80` and Node runs unprivileged;
  `Checking the ports` should report `✓ Ports free` and proceed to `.env` and model selection.

## Out of scope and follow-ups

- Checking IPv6 (`::1`) listeners: `docker-compose.yml` publishes every port on `127.0.0.1` only.
- Reusing `portFree` in `pnpm doctor` (M6 follow-up).

## Docs updated

None needed: `docs/setup.md` and `README.md` already document port `80` as the default for `pnpm run setup`.
