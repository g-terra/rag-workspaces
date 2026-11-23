---
title: Let admins create custom response styles
date: 2026-11-23
pr: pending
status: in review
areas: [api, db, shared, docs]
---

# Let admins create custom response styles

## Summary

Admins can create, change and delete their own response styles with `POST`, `PATCH` and `DELETE /v1/styles`.
A custom style works like a built-in one in every workspace. It can be named as `style` on a question or chat
message, or set as a workspace's `settings.style`, and `GET /v1/styles` lists it after the built-ins. Its
instructions are added after the system prompt behind the same reminder of the grounding rules.

## Why

Guilherme asked for support for creating your own styles, next to the built-in presets
([2026-11-23-response-styles.md](2026-11-23-response-styles.md)). On 2026-11-23 he chose one shared list for the
whole install, managed by admins, over styles per workspace ([decision 24](../decisions.md)).

## Design

1. **Table** `response_styles` (`packages/db/src/schema.ts`, migration `0011_custom_styles.sql`). The slug is
   the primary key. Other columns are `name`, `description`, `instructions`, `created_by` and timestamps. It has
   no workspace column, because the list is shared.
2. **Lookup** (`apps/api/src/services/styles.ts`). `findStyle(db, slug)` checks the built-ins first, then the
   table. It is now async, and so are `styleFor` and `listStyles`. An unknown slug is still `400`.
3. **Routes** (`apps/api/src/routes/styles.ts`, registered only when the API has a database):
   - `GET /v1/styles`: any signed-in caller. Built-ins come first, then custom styles by name.
   - `POST /v1/styles`: admins only. A slug that is taken, including a built-in slug, is `409`. Two creates
     racing for one slug end the same way (`onConflictDoNothing`).
   - `PATCH /v1/styles/{slug}`: admins only. Changes name, description or instructions. The slug never changes.
     A built-in style is `403` and an unknown one is `404`.
   - `DELETE /v1/styles/{slug}`: admins only. Returns `409`, naming the workspaces, while any workspace uses the
     style as `settings.style`. A built-in style is `403` and an unknown one is `404`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| One list for every workspace, admins only | Per workspace, managed by editors | Guilherme's choice on 2026-11-23: a style is written once and used everywhere. |
| Slug as the primary key | A generated id plus a unique slug | Requests, settings and stored answers all refer to the slug, so a second id would be unused. |
| Deleting a style that a workspace uses as its default is `409` | Clear those defaults, or let answers fail with `400` | Nothing changes behind an admin's back, and a workspace never points at a style that no longer exists. |
| Stored answers keep a deleted or edited style's slug | Copy the instructions onto each answer | Enough for analytics, and the answer text shows what the style did. |
| Built-ins are `403` on `PATCH` and `DELETE` | Allow overriding them in the table | They are versioned with the prompt in code, and every install has the same ones. |
| Instructions are capped at 2,000 characters | No cap | Keeps the prompt's added length bounded. The style is instructions, not a second system prompt. |

## Interfaces and contracts

- **HTTP API**: `POST /v1/styles` takes `{ slug, name, description?, instructions }` and returns `201` with the
  style (`builtIn: false`). `PATCH /v1/styles/{slug}` takes any of `name`, `description` and `instructions`, and
  returns `200`. `DELETE /v1/styles/{slug}` returns `204`. The status codes are `400` for validation, `403` for
  non-admins and built-ins, `404` for an unknown style, and `409` when a slug is taken or a style is still in use.
  `GET /v1/styles` now includes custom styles.
- **Configuration**: None.
- **Data**: the new table `response_styles`, from migration `0011_custom_styles.sql`.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

The API runs the migration on start. To remove a style that is in use, first set every workspace that uses it to
another style or to `null`. Deleting a style can't be undone, but answers that used it keep its slug.

Docs updated: `docs/api-schema.md` (the route table and the Response styles section) and `docs/decisions.md`
(decision 24 now describes what exists).

## Testing

- `apps/api/src/routes/styles.test.ts`: covers listing for people and API keys, and that a caller is required.
  It checks that only admins can create, change or delete. It checks that slugs are unique, built-ins included,
  and that bad input is refused. It covers changes, and `403` and `404` for built-in and unknown styles. It covers
  a custom style used as a workspace default, the `409` on delete while it is in use, and that a deleted style is
  then refused.
- `apps/api/src/routes/answers.test.ts`: a custom style's instructions reach the model's `system_message`.
- By hand: `POST /v1/styles` with a style, then ask a question with `"style": "<slug>"`.

## Out of scope and follow-ups

- The admin UI page to manage styles, and the picker in the playground.
- The MCP tool argument.
