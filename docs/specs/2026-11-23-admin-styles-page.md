---
title: Manage custom response styles in the admin UI
date: 2026-11-23
pr: "#114"
status: merged
areas: [admin, docs]
---

# Manage custom response styles in the admin UI

## Summary

A new admin page, **Response styles** (`/styles`, in the Admin section of the sidebar), lists the built-in styles
as read-only and the custom ones with Edit and Delete. **New style** opens a dialog for the name, slug (suggested
from the name), description and instructions. Deleting a style that a workspace uses as its default shows the
API's reason, which names the workspaces.

## Why

Guilherme asked for support to create your own styles. The API for it is
[2026-11-23-custom-styles.md](2026-11-23-custom-styles.md), and it is admin-only and shared by every workspace
(decision 24).

## Design

1. `apps/admin/src/styles/form.ts` holds the dialog's pure logic. `slugFor` suggests a slug from the name.
   `validateNewStyle` checks fields against the API's limits (name 60, description 200, instructions 2,000) and
   refuses a slug that is already listed. `validateStyleEdit` sends only the fields that changed.
2. `apps/admin/src/styles/queries.ts`: `useCreateStyle`, `useUpdateStyle` and `useDeleteStyle`. Each one
   invalidates `['styles']`, so every picker sees the change.
3. `apps/admin/src/components/style-dialogs.tsx`: `StyleDialog` (create or edit) and `DeleteStyleDialog`. The slug
   field is disabled when editing.
4. `apps/admin/src/routes/styles.tsx`: the page, with a Custom section first and a Built-in section after it, each
   style showing its instructions. Non-admins get an "Admins only" notice, like the API keys page.
5. The route goes in `router.tsx`, and the nav link in `components/app-layout.tsx`. The workspace Settings hint for
   the default style now points here.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A top-level admin page | A section in each workspace's settings | Styles are shared by every workspace, so they sit with the other install-wide admin pages. |
| Instructions are shown in full on the page | Hide them behind a toggle | The text is what decides the answers, and it is short (capped at 2,000 characters). |
| The slug is suggested from the name | Always typed | Most people never need to think about it. It is still editable before creation. |
| The in-use `409` is shown as the API wrote it | Look up the workspaces first | The API already names them, and that avoids a second request. |

## Interfaces and contracts

- **HTTP API**: None new. Uses `GET`, `POST`, `PATCH` and `DELETE /v1/styles`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

- `apps/admin/src/styles/form.test.ts`: covers slug suggestions (including accents and length), the create body,
  per-field errors, built-in slug clashes, the instructions cap, and edits that send only changes or nothing.
- `apps/admin/e2e/styles.spec.ts`: lists the built-ins read-only. Creates a style, checking that the slug follows
  the name, then edits it. A workspace using it as its default blocks the delete, and the alert names the
  workspace. Once that default is cleared, the delete succeeds.

## Out of scope and follow-ups

- The answer-quality check per built-in style (`docs/tuning.md`).

## Docs updated

`docs/guide/playground.md` (the Response styles page); the README no longer describes each page. `docs/api-schema.md` already describes the routes this page uses. `docs/guide/README.md` (the admin row of the roles table).
