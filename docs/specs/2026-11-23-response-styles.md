---
title: Choose a response style for answers and chat
date: 2026-11-23
pr: "#105"
status: merged
areas: [api, db, shared, docs]
---

# Choose a response style for answers and chat

## Summary

A **response style** changes how an answer reads (tone, length, format) without changing what it may
say. Four styles are built in: `academic`, `talkative`, `concise` and `tutor`. A style can be chosen per
question (`style` on `POST …/answers` and `POST …/conversations/{id}/messages`), or set as a workspace's
default (`settings.style`). `GET /v1/styles` lists the styles, and every stored answer and chat reply
records the style it used. A style is added after the workspace's system prompt and never replaces it,
so citations, refusals and complete lists still apply.

This is the first of several PRs. Custom styles, the MCP tool and the admin UI follow (see the end).

## Why

Guilherme asked on 2026-11-23 for configurable styles or personalities, for example more academic or
more talkative, with a few built in and support for custom ones.

The answer prompt was just tuned on the OUC material
([docs/tuning.md](../tuning.md), [2026-11-23-tuned-defaults.md](2026-11-23-tuned-defaults.md)). It asks for
`[n]` citations, a refusal with no outside knowledge, complete lists and every part of a question
answered. A workspace can replace that prompt with `settings.systemPrompt`, and then all of those rules
go with it. A style must not be able to do that. That is why a style is a short instruction appended
after the rules, and never a prompt of its own.

## Design

1. **Built-in styles** (`apps/api/src/services/styles.ts`, `BUILT_IN_STYLES`). Each has a `slug`, `name`,
   `description` and `instructions`. They live in code, are read-only and are the same on every install.
   - `academic`: formal register, precise terms, defined on first use, structured paragraphs.
   - `talkative`: warm and conversational, more explanation and connections between ideas from the
     passages, may end with a follow-up the material can answer.
   - `concise`: the shortest complete answer, no introduction or closing summary.
   - `tutor`: for a beginner, plain words, short steps, jargon explained.
2. **Prompt** (`composeSystemPrompt` in `styles.ts`). With no style, the system prompt is exactly what it
   is today. With one, this is appended after a blank line:

   ```text
   Response style: <name>. This changes only tone, length and format. Every rule above still applies:
   use only the passages, cite them with [n], give complete lists, and if the passages do not cover the
   question say only that.
   <instructions>
   ```

   The repeated rules come last on purpose, because small local models weigh the end of a prompt most. The
   style comes after the default prompt's "briefly", so a style like `talkative` may ask for longer answers.
   A workspace with its own `settings.systemPrompt` gets only "Every rule above still applies." in place of the
   recap, because its rules may differ from the built-in ones.
3. **Choosing** (`styleFor` in `styles.ts`, called by the answers and conversations routes before anything
   runs or streams). The style of a request is its `style` if given (`null` meaning none), else the
   workspace's `settings.style`, else none. An unknown slug in a request is `400`. A workspace default that
   no longer resolves is ignored, so callers never get a `400` for something they did not send. `PATCH` and
   `POST /v1/workspaces` refuse an unknown `settings.style` with `400`.
4. **Generation** (`Generator.generate` in `apps/api/src/services/generate.ts`) takes the resolved style
   and sends `composeSystemPrompt(base, style)` as the `LLM` node's `system_message`. Nothing changes in
   Langflow. The fixed "couldn't find anything" reply, given when no passage scores high enough, is the
   same in every style, because the model is not called.
5. **Recording**: `answers.style` and `messages.style` (new nullable text columns, migration `0010`) hold
   the slug used, or `null`. The API returns it as `style` on answers and messages.
6. **Listing**: `GET /v1/styles` returns every style any signed-in caller (person or API key) can use,
   with `builtIn: true`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A style is appended to the system prompt | A style is its own full prompt | A full prompt could drop citations and refusals, which the tuning depends on. Appending keeps one place for the rules. |
| The rules are repeated in the style header | Trust the rules above | A style like `talkative` pulls towards longer, freer answers. Repeating the rules at the end of the prompt keeps small models grounded. Costs about 40 tokens. |
| Chosen per request, with a workspace default | Workspace only, or per request only | Guilherme asked for both kinds of use: an agent or a person picks per question, and an admin sets the tone for a workspace. |
| Per message in a chat, not per conversation | A style fixed on the conversation | Simpler, and lets someone switch mid-conversation. The admin UI keeps the last choice. |
| The answer stores the slug | Store the full instructions | Enough to see which style an answer used (the usage log does not record it). Custom styles (next PR) can be edited, so a slug names the style, not its text at the time. |
| Built-ins in code | Seeded database rows | The same on every install, versioned with the prompt they extend, and nothing to migrate when they change. |
| Unknown style in a request is `400` | Ignore it and answer without a style | A typo should be visible to the caller rather than silently change the answer. |
| A stale workspace default is ignored | `400` on every question | The caller didn't send it, and one bad setting shouldn't stop a workspace from answering. |
| `style: null` asks for no style | No way to opt out of a default | An agent may want the plain prompt in a workspace that has a default. |

## Interfaces and contracts

- **HTTP API**:
  - `GET /v1/styles` (any signed-in caller): `{ "data": [{ "slug", "name", "description", "instructions", "builtIn" }] }`.
  - `POST /v1/workspaces/{slug}/answers` and `POST /v1/workspaces/{slug}/conversations/{id}/messages` take
    an optional `style` (a slug). Unknown → `400`.
  - Answers and assistant messages gain `style` (slug or `null`). User messages have `style: null`.
  - Workspace `settings.style` (slug or `null`), settable with `POST` and `PATCH` by admins. Unknown → `400`.
- **Configuration**: None.
- **Data**: migration `packages/db/drizzle/0010_response_styles.sql` adds `answers.style` and
  `messages.style` (nullable text). `workspaces.settings` (jsonb) may hold `style`.
- **Langflow**: None. The `LLM` node's `system_message` tweak carries the style.
- **Events and logs**: the SSE `done` event's answer or message carries `style`.

## Operations

The API runs the migration on start. Existing answers and messages get `style: null`. Nothing to undo:
removing a workspace's default is `PATCH { "settings": { "style": null } }`.

## Testing

- `apps/api/src/services/styles.test.ts`: no style leaves the prompt unchanged; a style is appended after
  the base prompt, custom prompts included; the rules are repeated; every built-in has a unique slug.
- `apps/api/src/routes/answers.test.ts`: `style` reaches the `LLM` tweak's `system_message` and is stored
  and returned; the workspace default applies; a request's style wins over the default; unknown is `400`;
  the not-found and failed answers record the style; `null` opts out of a default; a stale default is
  ignored; a workspace's own prompt gets no default-rule recap; a streamed answer's `done` carries the style and
  an unknown style is a plain `400` before the stream. The file raises `RATE_LIMIT_MODEL_PER_MINUTE` because it now
  asks more than 30 questions.
- `apps/api/src/routes/conversations.test.ts`: a message's style or the default reaches `rw-chat` and is stored on
  the reply only; a failed reply keeps its style; an unknown style is `400` with nothing run or stored.
- `apps/api/src/routes/workspaces.test.ts`: `settings.style` takes a known slug and `null`, refuses an
  unknown one.
- `apps/api/src/routes/styles.test.ts`: the list, and that it needs a signed-in caller.
- By hand: `curl -X POST …/v1/workspaces/ouc/answers -d '{"question":"…","style":"academic"}'` and compare
  with no style. A question the material does not cover should still be refused in every style.

## Out of scope and follow-ups

- **Custom styles** (next PR): a `response_styles` table and `POST`/`PATCH`/`DELETE /v1/styles`, admins
  only, shared by every workspace (Guilherme chose shared over per-workspace on 2026-11-23). Built-in
  slugs are reserved. Deleting a style that a workspace uses as its default is refused with `409`.
- **MCP**: a `style` argument on the ask tool and a tool that lists styles.
- **Admin UI**: a style picker in the playground, the default in workspace settings, and a page to
  manage custom styles.
- **Quality check**: a few questions per built-in style against a real model, to confirm citations and
  refusals hold, including a partly covered question. Results go in `docs/tuning.md`.

## Docs updated

`docs/api-schema.md` (route, fields, a Response styles section), `docs/decisions.md` (decision 24),
`docs/tuning.md` (styles sit after the tuned prompt). Also `docs/api.md` (the `style` parameter).
