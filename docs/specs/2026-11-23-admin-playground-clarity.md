---
title: explain the playground modes and hide conversation ids
date: 2026-11-23
pr: "#68"
status: merged
areas: [admin]
---

# Explain the playground modes and hide conversation ids

## Summary

The playground now says what the selected tab does, in one sentence under the Ask / Search / Chat
switcher (and as a tooltip on each tab). Conversation ids (`cnv_…`) are no longer shown to people: the
playground links to the conversation as "Saved in Conversations", and the Conversations page shows each
conversation by its title and time only.

## Why

Guilherme, 2026-11-23: "we need to add some explanation on what each tab is doing so it is more user
friendly" and "we dont need to show users the conversation id". The tabs' difference (one-shot answer,
model-free search, remembered conversation) was only explained in the specs
(`2026-11-23-admin-playground-ask.md`, `-search.md`, `-chat.md`), and ids are for the API, not for
people.

## Design

- `apps/admin/src/playground/search.ts`: `MODES` becomes `{ key, label, help }[]`; `help` is the
  sentence for each mode. `parseMode` reads `key`.
- `apps/admin/src/routes/playground.tsx`: a `#mode-help` line under the header shows the current mode's
  label and help; the tablist points at it with `aria-describedby`, and each tab has the help as its
  `title`.
- `apps/admin/src/playground/chat-panel.tsx`: the footer link reads "Saved in Conversations" and still
  opens `/w/:slug/conversations?c=…`. The id stays only in `data-conversation-id`, for the e2e tests.
- `apps/admin/src/routes/conversations.tsx`: the list rows show the updated time without the id; the open
  conversation's header reads "Started 5 min ago".

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A visible line under the tabs, plus a tooltip | Tooltip only; an info popover | A tooltip is invisible on touch and easy to miss; one line is always there and changes with the tab |
| Keep the id in a data attribute | Read it from the link's URL in tests | The attribute is explicit and survives a change to the URL shape |
| Leave answer (`ans_…`) and passage (`psg_…`) ids for now | Hide every id | The request named conversation ids; the others are a quick follow-up if wanted |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None. The playground's `data-testid="conversation-id"` became
  `conversation-link`, with the id in `data-conversation-id`.

## Operations

None.

## Testing

- `apps/admin/src/playground/search.test.ts`: every mode has a one-sentence help text; Search's says no
  model is called and Chat's mentions follow-ups.
- `apps/admin/e2e/playground.spec.ts`: the help line follows the tab (Search, Ask, Chat); the chat link
  reads "Saved in Conversations", no `cnv_` text is on the page, and the id in the attribute stays the
  same for a follow-up and changes for a new conversation.
- `apps/admin/e2e/conversations.spec.ts`: no `cnv_` text on the Conversations page.
- By hand: open the playground, switch tabs and read the line under them; start a chat and check the
  footer link opens it under Conversations.

## Out of scope and follow-ups

- Hiding answer and passage ids, if wanted.
- Markdown, settings defaults and PDF preview are separate PRs from the same request.

## Docs updated

None needed: no long-lived doc describes the playground's copy.
