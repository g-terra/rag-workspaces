---
title: Pick a response style in the playground and workspace settings
date: 2026-11-23
pr: "#112"
status: in review
areas: [admin, docs]
---

# Pick a response style in the playground and workspace settings

## Summary

The playground's Ask and Chat modes have a **Response style** picker. It offers the workspace's default (named),
No style, and every style from `GET /v1/styles`, built-in and custom. A workspace's Settings page has a
**Default response style** select. An answer's meta line says which style it was written in, for example
"2.3 s · a-model · academic style · 1,840 + 212 tokens".

## Why

This is the admin UI for response styles ([2026-11-23-response-styles.md](2026-11-23-response-styles.md),
[2026-11-23-custom-styles.md](2026-11-23-custom-styles.md)). Guilherme asked to be able to choose how answers read,
and the playground is where he tries questions.

## Design

1. `apps/admin/src/styles/styles.ts` holds the picker's pure logic. `WORKSPACE_DEFAULT` (`''`) leaves `style`
   out of the request, so the API applies the workspace's default. `NO_STYLE` (`'-'`, which is never a valid
   slug) sends `style: null`. Any other value is a slug. `styleChoices` builds the options, and `styleRequest`
   builds the request body part.
2. `apps/admin/src/styles/queries.ts`: `useStyles()` reads `GET /v1/styles` and caches it for a minute.
3. `apps/admin/src/playground/style-picker.tsx`: the select. Until the list loads it offers only the default and
   No style, so asking never waits on it. A picked style that disappears from the list (deleted meanwhile) falls
   back to the workspace default (`isGone`), so the picker never shows one choice and sends another.
4. Ask mode (`ask-panel.tsx`, `use-ask.ts`): the picker sits next to the passages count, and `ask()` takes the
   choice. Chat mode (`chat-panel.tsx`, `use-chat.ts`): the picker sits in the box's footer, and the choice
   applies to each message as it is sent. A retry uses the current choice.
5. Settings (`routes/workspace-settings.tsx`, `workspaces/settings.ts`): `style` is a form field like
   `reasoningEffort`. Empty is no default, and it is sent as `null`. A saved default that is missing from the list
   stays offered under its slug.
6. `answerMeta` (`playground/answer.ts`) adds "<slug> style" when an answer or reply has a style. This shows in
   the playground and in stored conversations.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Three kinds of choice: workspace default, no style, a style | Only the list of styles | Shows what an unpicked question will get, and lets someone compare against the plain prompt. |
| Meta shows the slug, not the name | Look up the name | The meta line is pure and shared with stored conversations. The slug reads well enough. |
| The create-workspace wizard doesn't ask for a style | A field in its Retrieval step | Another thread is reworking the wizard, and a default style is easy to set later in Settings. |
| Continuing a stored conversation (Conversations page) has no picker | Add it there too | That page continues a thread. The playground is where styles are tried. It uses the workspace default. |

## Interfaces and contracts

- **HTTP API**: None new. Uses `GET /v1/styles`, `style` on answers and messages, and `settings.style`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. Rebuild the admin image as usual.

## Testing

- `apps/admin/src/styles/styles.test.ts`: covers the request body for each kind of choice, the option labels, a
  default that isn't listed, and that the no-style value can't be a slug.
- `apps/admin/src/playground/answer.test.ts`: the meta line names the style.
- `apps/admin/src/workspaces/settings.test.ts`: covers setting a default style and clearing it to `null`.
- `apps/admin/e2e/playground.spec.ts`: picks Academic and asks, and the meta line says "academic style".
- By hand: in the playground, ask the same question in Concise and in Talkative and compare.

## Out of scope and follow-ups

- The page where admins create and edit custom styles (next PR).

## Docs updated

`README.md` (the Playground and Settings descriptions).
