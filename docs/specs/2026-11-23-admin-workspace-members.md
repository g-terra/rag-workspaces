---
title: Workspace members and deletion in the admin UI
date: 2026-11-23
pr: pending
status: proposed
areas: [admin]
---

# Workspace members and deletion in the admin UI

## Summary

Two more sections on `/w/<slug>/settings`: who has access to the workspace, and deleting it. Members
are listed with the person `GET /v1/users` says each granted id belongs to, their role can be changed
in place, and access can be removed. Access is granted from a searchable picker over Keycloak's
people, falling back to a plain user-id field when that list answers 503. Deleting takes the slug
typed out and then lands on the workspace list. No API, configuration or data change.

## Why

Milestone M4 in `docs/work-breakdown.md`, and the rest of the approved "Workspace settings" mock:
`2026-11-23-admin-workspace-settings.md` built the general, model and reindex sections and left these
two to keep that PR inside the size rule. `GET /v1/users` (`2026-11-23-users-list.md`) is what makes
the picker possible — before it, the only way to grant access was to paste a Keycloak id.

## Design

1. **The module** (`src/workspaces/members.ts`, no React, unit-tested). `memberRows()` joins the
   granted roles to the people the directory returned. A member the directory cannot name is **kept**
   and shown by its raw id: the grant is real whatever Keycloak says, and hiding the row would hide
   the access. `personLabel()` falls back name → username → id, and `personNote()` carries the email,
   "sign-in disabled" for a disabled account, and the day access was granted in UTC. It takes
   `directoryRead` as well, because a row has no person for three different reasons and only one of
   them is "Keycloak does not know this id": saying "not in the directory" while the list is still
   loading, or while it is answering 503, would accuse every real account on the page of not existing.
   The names come from the unfiltered first page **and** from whatever the picker's search returned,
   so the person just granted is named at once instead of appearing as a bare id — the unfiltered page
   holds 50 accounts and a newly found person is usually not among them.
2. **Granting** (`src/components/workspace-members.tsx`). The picker is a search box over
   `GET /v1/users?search=`, Keycloak's own search across username, email and name, with a select of
   what came back. `candidates()` marks, rather than hides, the people a grant would not change:
   someone already listed, and any admin, who reaches every workspace without being a member. A
   disabled, labelled option answers "why isn't this person in the list?"; leaving them out would
   not. When `GET /v1/users` answers **503** — Keycloak unreachable, or its people list never set up
   (no `KEYCLOAK_DIRECTORY_SECRET`) — the picker is replaced by a plain user-id field, which is what
   the API has always accepted; `directoryUnavailable()` is that one check, and any other failure is
   reported as itself rather than silently degrading.
3. **Changing and removing** (`src/workspaces/member-queries.ts`). The role select writes with the
   same `PUT .../members/{userId}` that grants, because the route upserts. Removing is a direct
   `DELETE`, with no confirmation: it is the one destructive action on this page that is undone by
   granting again. Both invalidate `['workspaces', slug, 'members']`, and both controls are disabled
   while *either* is in flight — the `PUT` upserts, so a `DELETE` that commits first would be undone
   by it and leave the person with access and no error on screen. Starting one clears the other's
   error, so a failed role change cannot leave its message above a list that is now correct. Each
   row's Remove button carries the person's name in its accessible name, so the buttons are told
   apart by anyone reading them out.
4. **Deleting** (`src/components/delete-workspace-dialog.tsx`). The dialog names what goes —
   documents, uploaded files, the Chroma collection, conversations, usage history — and that an API
   key able to reach only this workspace is revoked with it, which is the part a reader is least
   likely to expect. `deleteIsConfirmed()` wants the slug typed exactly (trimmed, case-sensitive),
   and the button stays disabled until it is. On success the page navigates to `/workspaces` with
   `replace`, so Back does not return to a workspace that no longer exists; the remembered "last
   used" slug needs no clearing, because `landingPath()` already ignores a slug that is not in the
   list. `useDeleteWorkspace` removes the workspace's own cache entries and invalidates both
   `['workspaces']` and `['api-keys']`, since a key may have been revoked with it.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Keep a member the directory cannot name | Hide the row; show "unknown" with no id | The grant is real whatever Keycloak says; a hidden row is hidden access, and the id is what `DELETE` needs |
| Mark covered people in the picker, disabled | Filter them out | A missing name reads as a broken search; "an admin, so already has access" answers the question the absence would raise |
| Fall back to a user-id field on 503 only | Always offer the id field; block the section | 503 is the documented "no people list" answer; any other failure is a real error and is shown as one, not worked around |
| Remove access without a confirmation | A confirm dialog, like revoke and delete | It is undone by granting again; the mock has no dialog either, and a prompt on a reversible action trains people to click through them |
| Delete behind the slug typed out | A plain confirm; a "yes, delete" checkbox | It is the one irreversible action in the admin UI, and it takes documents, vectors, conversations and usage history with it |
| `replace` on the way to `/workspaces` | A plain push | Back would otherwise return to a workspace whose every request now 404s |
| The role select writes on change | A separate save button per row | The route upserts, so the change is one request; a per-row save adds a step for a one-value form |
| Invalidate `['api-keys']` after a delete | Leave it | A key bound only to this workspace is revoked by the API, so the keys page would otherwise show it active |
| Name rows from the search's results too | Only the unfiltered first page | The person just granted is rarely in the first 50, and would come back as a bare id labelled as unknown |
| "not in the directory" only once the list answered | Say it whenever no person matched | With no `KEYCLOAK_DIRECTORY_SECRET` it would be said about every real account, and it would flash on every load |
| The search is debounced by 300 ms | A request per keystroke | Each search makes the API ask Keycloak for every match's realm roles, so a five-letter name was hundreds of admin calls |
| Both controls disabled while either writes | Disable each on its own | `PUT` upserts, so Remove racing a role change silently re-grants access |
| "N of M found can be added" | "M found" | Matches that already have access are shown but not selectable, so a bare count can promise people who cannot be picked |

## Interfaces and contracts

- **HTTP API**: none changed. The UI reads `GET /v1/workspaces/{slug}/members` and `GET /v1/users`,
  and calls `PUT`/`DELETE /v1/workspaces/{slug}/members/{userId}` and
  `DELETE /v1/workspaces/{slug}` (204).
- **Configuration**: none. `KEYCLOAK_DIRECTORY_SECRET` being unset is what makes `GET /v1/users`
  answer 503, which this screen handles rather than requires.
- **Data**: none of its own; `DELETE /v1/workspaces/{slug}` removes that workspace's rows, as that
  route already did.
- **Langflow**: none.
- **Events and logs**: none.

## Operations

Existing installs: `docker compose up -d --build web`. Nothing to migrate. Deleting a workspace
cannot be undone and is the one action here that destroys data; it is the API route's own behaviour,
and `2026-11-20-workspaces.md` covers what it removes. If `GET /v1/users` answers 503 in an install
that wants the picker, set `KEYCLOAK_DIRECTORY_SECRET` (`2026-11-23-users-list.md`) — until then,
granting by Keycloak user id still works.

## Testing

- `apps/admin/src/workspaces/members.test.ts` (20 cases): the join in both directions including a
  member the directory does not know and a directory that has not answered, the label's three
  fallbacks, the note with an email, with "not in the directory" and with a disabled account,
  `candidates()` marking an existing member and an admin, the note accusing nobody when the directory
  was never read, `directoryUnavailable()` on 503 and not on anything else, the member and delete messages in words, and the slug confirmation (trimmed, and
  case-sensitive).
- `apps/admin/e2e/workspace-members.spec.ts` (3 tests, real stack): a throwaway workspace per run.
  The first checks a new workspace says nobody has been granted access and that the signed-in admin
  appears in the picker marked and unselectable. The second grants a Keycloak id nobody has signed in
  with — which the API accepts, and which is also the "not in the directory" row — then changes the
  role in place, reloads to prove it stuck, and removes it. The third deletes a workspace: the button
  stays disabled for the wrong case and a partial slug, and after confirming the page lands on the
  list and the API answers 404 for the slug.

By hand: with `KEYCLOAK_DIRECTORY_SECRET` unset, check the Members section asks for a Keycloak user
id and still grants. Create a key bound only to one workspace, delete that workspace, and check the
key shows as revoked on the API keys page.

## Out of scope and follow-ups

Paging the people list (the picker shows the first 50 matches of Keycloak's own search, and the rows
are named from those matches plus the unfiltered first 50; following `nextCursor`, or asking the API
for a person by id, is the follow-up for a realm large enough that a member falls outside both). Also not here:
inviting or creating accounts, which belongs in Keycloak's console (decision 12); the mock's row for
the signed-in admin as a locked member, since admins are not members at all; and a count of what a
delete will remove, which would mean asking for every document, conversation and passage first.

## Docs updated

`README.md` (members and deleting a workspace in the admin UI).
