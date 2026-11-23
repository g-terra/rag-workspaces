---
title: API keys page in the admin UI
date: 2026-11-23
pr: "#54"
status: merged
areas: [admin]
---

# API keys page in the admin UI

## Summary

`/api-keys` is a new admin-only screen in the sidebar's "Admin" section. It lists every API key with its
prefix, role, bound workspaces, last use and expiry, and marks the revoked and expired ones. "Create key"
asks for a name, a role (reader or editor), the workspaces to bind and an expiry (Never, in 30 days, in 90
days, or a date), then shows the secret once with a Copy button and a ready-to-run `curl` example. A key
can be renamed, rebound and re-dated afterwards; its role never changes. Revoke asks for confirmation and
leaves the key listed as revoked. A fix travels with it: Vite's dev and preview proxy matched `/api`, so a
browser asking for `/api-keys` was forwarded to the API instead of the app.

## Why

Milestone M4 in `docs/work-breakdown.md` ("API keys: list, create with workspaces and role, copy-once
secret"). The routes exist since `2026-11-20-api-keys.md`; until now the only way to make a key was
Swagger. Layout and copy follow the approved "API keys" mock.

## Design

1. **Route and nav** (`src/router.tsx`, `src/components/app-layout.tsx`). `api-keys` is a child of
   `AppLayout`, and the "Admin" nav (which only renders for admins) gains an "API keys" link. Reaching the
   URL as a non-admin shows an "Admins only" notice rather than letting every request answer 403.
2. **Vite proxy** (`apps/admin/vite.config.ts`). The proxy key is now the regex `^/api/`, so only real API
   calls are forwarded. With the old `/api` prefix, loading `http://localhost:5173/api-keys` reached the
   API as `GET /-keys` and answered problem JSON. nginx was always right (`location /api/`), so this only
   ever affected `pnpm dev` and `vite preview`.
3. **Data** (`src/api-keys/queries.ts`). `useApiKeys()` reads `GET /v1/api-keys` under the query key
   `['api-keys']`; `useCreateApiKey()`, `useUpdateApiKey(id)` and `useRevokeApiKey(id)` call `POST`,
   `PATCH` and `DELETE` and invalidate that key, so the list follows without its own refetch logic.
4. **Form logic** (`src/api-keys/keys.ts`, no React, unit-tested).
   - `expiresAtFor()` turns the mock's four expiry choices into what the API wants: `null` for Never,
     `now + 30/90 days`, or `23:59:59.999Z` on a chosen date, so a key dated "31 Dec" works all of 31
     December.
   - `validateCreate()` checks the form with `CreateApiKey` from `@rag/shared` and turns zod's messages
     into "Enter a name.", "Pick at least one workspace.", "Pick a date.", "Pick a date in the future."
   - `validateEdit()` builds an `UpdateApiKey` body holding **only** what differs from the key, and never
     `role` (the API answers 400 by design, so a key cannot gain rights silently). Keeping the date the
     key already expires on counts as no change, so saving a new name doesn't move the expiry by a few
     hours. Nothing changed at all is reported as "Nothing to change." instead of an empty request.
   - `keyState()` and `formatExpiry()` give the row its "Revoked"/"Expired" pill and its "Never", "Expired"
     or "31 Dec 2026" cell. `formatDay()` formats that date in UTC, because the API stores and the date
     input picks a UTC day: the browser's own day would read one off for anyone east of UTC (a key dated
     31 Dec would say 1 Jan). `curlExample()` builds the example request.
5. **The page** (`src/routes/api-keys.tsx`). The table from the mock (Name, Key, Role, Workspaces, Last
   used, Expires, actions), with `Loading`, `ErrorState` and an empty state, and the mock's closing line
   about hashed secrets. Edit and Revoke only appear on keys that are not revoked — `PATCH` on a revoked
   key answers 409, and a revoked key is final.
6. **The dialogs** (`src/components/api-key-dialogs.tsx`). One `KeyFields` block serves create and edit
   (name, workspace checkboxes from `useWorkspaces()`, expiry select plus date input); the role radios
   only render while creating, and the edit dialog shows the role as text with the reason it is fixed.
   After a successful create, the same dialog switches to the secret panel: the secret in a read-only
   field with Copy, the `curl` example, and Done. Every way out of the dialog runs the same `close()`,
   so the next "Create key" opens an empty form and never the secret of the key before it. Copy is
   wrapped in `try`/`catch` as well as `.catch()`: served over plain HTTP on anything but `localhost`
   there is no `navigator.clipboard` at all, and the "copy it by hand" line has to cover that too.
7. **Shared pieces.** The labelled-field helper moved out of the create-workspace dialog to
   `src/components/field.tsx`, and the relative-date formatter from the documents module to
   `src/lib/dates.ts` as `formatRelative()`, since both screens now need them.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Leave out the mock's "Purpose: General / Langflow" | Store it client-side; add an API field | There is no field for it, and `docs/api-schema.md` settles that the API calls Langflow and never the reverse, so a Langflow key has nothing to configure |
| Leave out "Requests (7d)" | Query `/v1/usage/timeseries?groupBy=apiKey` per page load | The key has no request count (the schema marks it planned), and a usage query per key is a lot of work for a column nobody can act on |
| `curl` example against the UI's own origin + `/api` | Hard-code `http://localhost:3000` as the mock does | The browser cannot know where the API is published; the origin it is already talking to is true in compose, in `vite preview` and behind any other host name |
| Only what changed in `PATCH` | Send the whole form | `UpdateApiKey` is `.strict()` and refuses `role`; a diff keeps the request honest and lets "Nothing to change." be a message instead of a no-op request |
| Custom expiry at the end of the day, UTC | Midnight at the start of the day; the browser's zone | Midnight would expire a key the moment the date arrives; UTC matches what the API stores and what the list shows back |
| Plain radios, checkboxes and `<select>` | Copy shadcn's RadioGroup, Checkbox and Select | Three more dependencies and three more files for controls the browser already gives us, labelled and keyboard-accessible |
| Revoked keys keep no actions | Disabled buttons with a tooltip | The API answers 409; the mock's row has nothing to offer either |
| An "Admins only" notice on the page | Redirect to `/workspaces`; no guard at all | A notice says what happened; a redirect looks like a bug, and no guard means five failed requests |

## Interfaces and contracts

- **HTTP API**: none changed. The UI calls `GET/POST /api/v1/api-keys`, `PATCH /api/v1/api-keys/{keyId}`,
  `DELETE /api/v1/api-keys/{keyId}` and `GET /api/v1/workspaces` with the bearer token.
- **Configuration**: none.
- **Data**: none.
- **Langflow**: none.
- **Events and logs**: none.

## Operations

Existing installs: `docker compose up -d --build web`. Revoking is permanent; the key stays listed so
usage history keeps its name. A secret is shown exactly once — if it is lost, make a new key and revoke
the old one. Anyone running `pnpm dev` keeps the Vite proxy fix automatically.

## Testing

- `apps/admin/src/api-keys/keys.test.ts` (18 cases): the expiry choices (including a custom date's end of
  day); create validation (empty name, no workspace, missing date, a date in the past, a name over 100
  characters, a valid body); edit bodies carrying only the changed name, workspaces or expiry, clearing an
  expiry, treating the key's own expiry date as no change, reporting "Nothing to change.", still refusing
  an empty name or a past date, refusing "Custom date" with no date even on a key that never expires
  (both mean `null`, so the diff alone would have dropped that choice silently), and letting an expired
  key be renamed without re-dating it; `formatDay` under a non-UTC `TZ`; `formatExpiry` for
  never/expired/dated; `keyState` for revoked, expired and active (revoked wins); `curlExample`.
- `apps/admin/src/lib/dates.test.ts`: the relative-date wording, moved with the function.
- `apps/admin/e2e/api-keys.spec.ts` (real stack): an admin opens the page from the nav, creates an editor
  key bound to a throwaway workspace with a 30-day expiry, sees the secret and the `curl` example carrying
  that secret and workspace, closes the panel, finds the row with its role, workspace, "Never used" and
  the expiry date, reopens "Create key" to find an empty form rather than the secret just shown, renames
  the key and sets the expiry to Never (the role is read-only), cancels a revoke
  and then confirms it, and sees the row revoked with no Edit button. A second test sees "Pick at least
  one workspace." and "Pick a date in the future." in the create dialog. Both revoke their keys and delete
  their workspace afterwards.

By hand: open `http://localhost:18080/api-keys` directly (the proxy fix), then use a created key against
the API: `curl -H "Authorization: Bearer <secret>" http://localhost:13000/v1/workspaces/<slug>/passages?query=test`,
and check it stops working after Revoke (401).

## Out of scope and follow-ups

The mock's Purpose column and Langflow set-up steps, and its "Requests (7d)" column (see the table above);
a key's own usage page; rotating a secret in place (make a new key and revoke the old one); searching or
filtering the key list, which can wait until a deployment has enough keys to need it.

## Docs updated

`docs/api-schema.md` (the API keys table now says the admin UI manages keys, not only Swagger) and
`README.md` (the admin UI's screens).
