---
title: Create workspace dialog in the admin UI
date: 2026-11-22
pr: pending
status: proposed
areas: [admin]
---

# Create workspace dialog in the admin UI

## Summary

Admins can now create a workspace from the admin UI: "New workspace" on the "All workspaces" page, or
"Create workspace" in the sidebar's workspace switcher, opens a dialog with name, slug and description.
The slug is suggested from the name until the admin edits it. On success the list refreshes and the admin
lands on the new workspace. Model and retrieval settings keep the defaults from `.env`. This builds on the
read-only workspace screens in `2026-11-22-admin-workspaces.md`.

## Why

Milestone M4 in `docs/work-breakdown.md`: the admin UI against the real API. The scope agreed with the
owner: "an admin-only New workspace dialog with name, slug and description. Model settings stay on their
defaults until the settings screen later." The API route (`POST /v1/workspaces`, admin only, `409` for a
taken slug) is in `2026-11-20-workspaces.md`. Layout and copy follow the dialog in the approved
"Workspaces" mock, without its model settings block.

## Design

1. **Entry points**. `src/routes/workspaces.tsx` shows "New workspace" to admins, in the header and as
   the "Create your first workspace" call to action when there are none (replacing the "No workspaces
   yet" note). `src/components/workspace-switcher.tsx` adds an admin-only "Create workspace" row; it
   closes the popover and opens the dialog. Non-admins see neither; the API would refuse them anyway.
2. **Dialog** (`src/components/create-workspace-dialog.tsx`, shadcn `ui/dialog.tsx` and `ui/input.tsx`).
   The form lives inside the dialog content, so it unmounts on close and starts empty next time. The slug
   follows `suggestSlug(name)` (`src/workspaces/slug.ts`) until the admin types in the slug field. The
   suggestion spells out letters like `ß` and `æ`, drops accents, and is left empty when the name gives
   fewer than 3 usable characters ("AI", or a name in another script), so the admin types one instead
   of getting a slug the API would refuse. The dialog stays open while the request runs, and on close
   focus goes back to the control that opened it (`returnFocusTo`). Each field's hint or error is its
   accessible description (`aria-describedby`) and is announced when it changes; editing a field clears
   its error.
3. **Validation** (`src/workspaces/create.ts`). On submit, `validateCreate()` runs the shared
   `CreateWorkspace` zod schema from `@rag/shared`, the same one the API uses, and puts the first
   message for each field under that field, with zod's length messages rewritten in plain words ("Enter
   a name.", "Use at least 3 characters."). An empty description is sent as `null`.
4. **Request** (`useCreateWorkspace()` in `src/workspaces/queries.ts`). `POST /v1/workspaces` through
   `useAuth().api`, then invalidates `['workspaces']`, which refreshes the list, the switcher and any
   cached workspace.
5. **Errors**. `createErrorMessage()` maps the API's answer: `409` goes under the slug ("The slug "x" is
   taken."), `400` and `422` show on the form with the API's detail, anything else shows "Couldn't create
   the workspace: <cause>". The button shows "Creating…" and is disabled while the request runs.
6. **Success**. The dialog closes and the admin goes to `/w/<slug>`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Validate with the shared `CreateWorkspace` schema | Hand-written checks in the form; rely on the API only | One rule set for both sides, and the errors show per field before a round trip |
| Suggest the slug from the name until edited | No suggestion; always derived | Most slugs are the name in lower case; once the admin types their own, it is never overwritten |
| No model or retrieval settings in the dialog | The mock's settings block | Agreed with the owner: they come with the settings screen; the defaults from `.env` are pinned at creation |
| `400` details shown as one form message | Map the API's `errors` array onto fields | `ApiError` keeps only `detail`; the same schema already ran in the browser, so a `400` is rare |
| Copied shadcn `dialog` and `input`, trimmed to the parts used | A component library | Same approach as `button.tsx` and `popover.tsx` |

## Interfaces and contracts

- **HTTP API**: None changed. The UI calls `POST /api/v1/workspaces` with the bearer token.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Existing installs: `docker compose up -d --build web`. A created workspace can be deleted with
`DELETE /v1/workspaces/{slug}` until the settings screen offers it.

## Testing

- `apps/admin/src/workspaces/slug.test.ts`: `suggestSlug()` lowercases, turns spaces and symbols into
  single hyphens, drops accents, spells out `ß`/`æ`/`œ`, starts with a letter, trims to 40 characters
  without a trailing hyphen, and suggests nothing for names that would give an invalid slug.
- `apps/admin/src/workspaces/create.test.ts`: `validateCreate()` field errors in plain words and the body it sends;
  `createErrorMessage()` for `409`, `400`/`422` and other errors.
- `apps/admin/e2e/workspaces.spec.ts`, "an admin creates workspaces from the list and from the
  switcher": checks the slug suggestion, creates one workspace from each entry point, lands on each, sees
  a taken slug refused under the slug field (as the field's accessible description), focus going back to
  the opener after Escape from both entry points, and finds the new one in the list without a reload. The
  workspaces are deleted through the API afterwards.

By hand: sign in as an admin, create a workspace from "All workspaces" and from the switcher, try a
taken slug and an invalid one (`9-lives`). Sign in as a non-admin: no create button or row.

## Out of scope and follow-ups

Model and retrieval settings, members, renaming and deleting a workspace (settings screen, later in M4).

## Docs updated

`README.md` (admins create workspaces from the admin UI).
