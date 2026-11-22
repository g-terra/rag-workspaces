---
title: Workspaces CRUD, Chroma collections, members and the 404-not-403 access check (auth 3/3)
date: 2026-11-20
pr: '#13'
status: merged
areas: [api, db]
---

# Workspaces CRUD, Chroma collections, members and the 404-not-403 access check (auth 3/3)

## Summary

Adds workspace routes (list, create, get, update, delete), workspace members, and `requireWorkspace()`,
the single access check every workspace route uses. Creating a workspace creates its Chroma collection
`ws_<slug>` and pins its embedding provider and model. A caller without access gets 404, so other
workspaces stay invisible; a caller with too low a role gets 403.

## Why

Decision 2 (isolated workspaces, each with its own collection, routes and keys) and decision 9 (keys
bound to workspaces). Last of the three auth changes, after Keycloak tokens (#11) and API keys (#12).

## Design

1. `apps/api/src/auth/access.ts`, `requireWorkspace(db, principal, slug, need)`:
   - admins get `admin` everywhere, without a member row;
   - a person gets the role from `workspace_members`;
   - an API key gets its role in its bound workspaces only;
   - no access → 404; access below `need` → 403.
2. `apps/api/src/routes/workspaces.ts`:
   - create (admin) makes the Chroma collection first (cosine, same settings as the ingest flow), then
     the row;
   - delete removes the row, members and key bindings in a transaction, revokes keys left without a
     workspace, then drops the collection.
3. `apps/api/src/services/chroma.ts`: collection create and delete over Chroma's REST API.
4. Migration `0002_workspace_members.sql`: `workspace_members` keyed by Keycloak user id and workspace,
   with the `workspace_role` enum.
5. `packages/shared/src/workspaces.ts`: zod shapes, including `settings` validation (providers, chunk
   sizes, top-k and score ranges).

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| 404 for no access, 403 for too low a role | 403 for both | Don't reveal which workspaces exist |
| Admins are not members | Auto-add admins as members | One rule: the realm role decides |
| Embedding provider and model pinned at create; PATCH refuses them (400) | Allow change | Changing them needs a full reindex; an `.env` change must not break old workspaces |
| Create: Chroma first; delete: Postgres first | Same order | A Chroma outage never leaves a half-made workspace; a leftover collection after delete is harmless |
| No `stats` block yet | Return zeros | Rule 1; counts arrive with the tables they count |

## Interfaces and contracts

- **HTTP API**:
  - `GET /v1/workspaces` (each item has `access`: `admin`, `editor` or `reader`);
  - `POST /v1/workspaces` (admin; 409 for a taken slug, also under a race);
  - `GET|PATCH|DELETE /v1/workspaces/{slug}` (PATCH merges settings, `null` resets one to default);
  - `GET /v1/workspaces/{slug}/members`, `PUT .../members/{userId}`, `DELETE .../members/{userId}`
    (admin).
- **Configuration**: `DEFAULT_EMBEDDING_PROVIDER`, `DEFAULT_EMBEDDING_MODEL`.
- **Data**: table `workspace_members`; Chroma collection `ws_<slug>` per workspace.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Hard to undo: collection naming `ws_<slug>` and the 404-for-no-access rule. Granting access needs the
person's Keycloak user id (copy it from the Keycloak console until `GET /v1/users` exists).

## Testing

`apps/api/src/routes/workspaces.test.ts` against Postgres with a fake Chroma: CRUD, settings merge and
reset, pinned embedding fields, 409 under a race, create with Chroma down stores no row, delete revokes
orphaned keys, member grant/change/remove, isolation (key for A gets 404 on B), anonymous 401, editor
403 on admin actions. Checked on the live stack with a real Keycloak admin token.

## Out of scope and follow-ups

`GET /v1/users` picker, provider names checked against `.env` (`GET /v1/system`), workspace stats,
workspace reindex and the embedding settings lock.

## Docs updated

None needed: `docs/api-schema.md` already described the routes and the 404 rule.
