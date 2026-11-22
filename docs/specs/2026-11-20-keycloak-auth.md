---
title: Keycloak token verification and GET /v1/me (auth 1/3)
date: 2026-11-20
pr: '#11'
status: merged
areas: [api]
---

# Keycloak token verification and GET /v1/me (auth 1/3)

## Summary

The API verifies Keycloak access tokens on every request and exposes the caller at `GET /v1/me`. Routes
opt in to authentication with a `requireUser` guard, so `/health`, `/ready` and `/docs` stay public.
First of three auth changes: Keycloak tokens, then API keys (#12), then workspace access (#13).

## Why

Decision 8 (Keycloak for login). The compose spec flagged the issuer split: the API reaches Keycloak at
`keycloak:8080`, but tokens carry the public issuer `localhost:8081`.

## Design

1. `apps/api/src/auth/plugin.ts`: on every request, read `Authorization: Bearer ...`. Credentials
   starting with `rw_` are never treated as JWTs. Set `request.principal`.
2. `apps/api/src/auth/keycloak.ts`: verify with `jose`: RS256 signature against the JWKS fetched from
   `KEYCLOAK_INTERNAL_URL`, `iss` equal to `KEYCLOAK_PUBLIC_URL/realms/<realm>`, audience `api`, expiry
   with 5 s tolerance. Map to a principal: `id` (sub), `username`, `email`, `name`, `isAdmin` (realm role
   `admin`).
3. `requireUser` pre-handler rejects anonymous callers with 401 + `WWW-Authenticate: Bearer`.
4. `apps/api/src/routes/me.ts`: `GET /v1/me`.
5. Swagger declares `bearerAuth`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Keys fetched internally, issuer checked against the public URL | Use the discovery document | Discovery fetched internally still points `jwks_uri` at localhost |
| One client message for every bad token ("Invalid or expired token.") | Say why | The reason goes to the log; probes learn nothing |
| Keycloak unreachable → 503, not 401 | 401 | An outage must not look like a bad token |
| A bad token is rejected even on public routes | Ignore it there | Clearer for anyone debugging a script |
| `principal` is a union | User only | API keys add `kind: 'key'` next |

## Interfaces and contracts

- **HTTP API**: `GET /v1/me` → `{ kind: 'user', id, username, email, name, isAdmin }` (email and name
  nullable); 401 with
  `WWW-Authenticate: Bearer` and problem JSON; 503 when Keycloak can't be reached.
- **Configuration**: `KEYCLOAK_PUBLIC_URL` (the issuer every token carries), `KEYCLOAK_INTERNAL_URL`,
  `KEYCLOAK_REALM`, audience `api`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: rejection reason logged at debug/warn with the request id.

## Operations

If the Keycloak port or hostname changes, change `KEYCLOAK_PUBLIC_URL`. Keycloak key rotation is
handled by `jose`'s JWKS cache (refetch on unknown `kid`).

## Testing

`apps/api/src/auth/auth.test.ts` with `src/test/tokens.ts` (a throwaway signing key standing in for
Keycloak): valid token, expired, wrong issuer (including the internal URL), wrong audience, bad
signature, `alg: none`, HS256, missing `sub`, unreachable Keycloak (503). Checked against the real
Keycloak with the password grant enabled temporarily on the running realm.

## Out of scope and follow-ups

API keys (#12), workspace roles (#13), rate limiting (later), login in the admin UI (M4).

## Docs updated

None needed: `docs/architecture.md` "Auth" already described this.
