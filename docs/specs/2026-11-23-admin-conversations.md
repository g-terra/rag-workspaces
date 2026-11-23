---
title: The conversations screen in the admin UI
date: 2026-11-23
pr: pending
status: proposed
areas: [admin]
---

# The conversations screen in the admin UI

## Summary

A new screen, `/w/:slug/conversations`: the conversations held with this workspace, most recently active
first, and one of them in full — every message, the passages each reply was given, and a box to carry it
on. A conversation can be deleted, after a confirmation. The open one is in the URL (`?c=cnv_…`), and
Chat mode in the playground now links the conversation it started to this screen. Follows
`2026-11-23-admin-playground-chat.md` and completes milestone M4's admin screens.

## Why

Milestone M4, and the owner's ask. Chat mode stores conversations that outlive the page it typed them
in, and until now nothing in the UI could show them again: you could not read what an agent asked
yesterday, see which passages a reply was given, continue a thread, or clean up. The routes have existed
since `2026-11-20-conversations.md`; this is their screen. Layout and copy follow the approved
"Conversations" mock.

## Design

1. **The list** (`src/conversations/queries.ts`, `src/routes/conversations.tsx`). `useConversations()` is
   a `useInfiniteQuery` over `GET …/conversations?limit=20&cursor=`, which is how the API pages it, and
   `select` flattens the pages so the screen reads one array. "Load more" asks for the next cursor. Each
   row shows `conversationName()` (the API titles a conversation from its first message; one with no
   title still needs a name), its id and when it was last active, through the library's
   `formatUpdated()`.
2. **The thread** (`src/routes/conversations.tsx`). `useConversation()` reads `GET
   …/conversations/{id}` once: your messages as bubbles, replies as cards with their meta line and their
   sources beside them, through the same `Sources` the playground uses, so a citation opens the same
   passage preview. `messageBody()` (`src/conversations/thread.ts`) decides what a stored message shows:
   what was written, the reason it failed, or why a reply that found nothing has no text.
3. **Carrying it on** (`src/playground/use-chat.ts`, `chat-view.tsx`). `useChat()` takes an optional
   conversation id, so the same hook that starts a conversation in the playground continues a stored one
   here; the component is keyed by conversation, which is how the id is read once. The stored messages
   are what was there when the screen opened and the live turns are what this page added, so nothing is
   shown twice and no refetch is needed. The box and the turn view moved out of `chat-panel.tsx`
   unchanged into `chat-view.tsx`, which both screens now render.
4. **Deleting** (`src/conversations/queries.ts`). A confirmation dialog naming the conversation and how
   many messages go with it, then `DELETE …/conversations/{id}`, the list invalidated and the selection
   cleared. It follows the library's delete dialog, including returning focus to the list rather than to
   a button that no longer exists.
5. **Getting there** (`src/components/workspace-nav.tsx`, `src/playground/chat-panel.tsx`). A
   "Conversations" entry in the workspace nav for every access level — a reader's conversations are their
   own — and the conversation id in Chat mode's footer is now a link to `?c=` on this screen.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| The open conversation is in the URL | Component state | The playground links straight to the conversation it started, and a reload keeps the one you were reading |
| Stored messages and live turns side by side | Refetch the thread after every reply | A refetch would show the reply twice for a moment, or replace a streamed reply with a fetched one |
| `useChat` takes an existing id | A second hook for continuing | Sending a message is the same request; only the conversation's origin differs |
| Keyed by conversation id | Read the id on every render | The hook holds the conversation it is sending to; keying is how React restarts it cleanly |
| An infinite query with "Load more" | Load every conversation | The API pages at 20, and a workspace an agent uses accumulates conversations without end |
| Delete asks first | Delete on the button | It removes every message in the thread and cannot be undone |
| No rename | Rename inline | The API takes a title only when a conversation is created; there is no route to change it |
| Nav entry for readers too | Editors and admins only | The API scopes conversations to their owner, so a reader sees only their own |

## Interfaces and contracts

- **HTTP API**: None changed. The UI calls `GET /api/v1/workspaces/{slug}/conversations`, `GET
  …/conversations/{id}`, `DELETE …/conversations/{id}` and, to carry one on, `POST
  …/conversations/{id}/messages`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Existing installs: `docker compose up -d --build web`. `/w/<slug>/conversations` and
`/w/<slug>/conversations?c=cnv_…` are new link shapes. Deleting a conversation is permanent, and removes
its messages; the answers those replies cited are untouched.

## Testing

- `apps/admin/src/conversations/thread.test.ts`: `conversationName()` with a title, with none and with a
  blank one; `messageBody()` for a reply, for one that found nothing relevant enough, for one that failed
  with and without a reason, and for one that failed after writing some of its reply.
- `apps/admin/e2e/conversations.spec.ts` (real stack): a workspace with no conversations offers Chat
  instead of an empty list; a conversation started in the playground links here; the thread shows both
  sides of the turn with one source, and the source opens the passage preview; a follow-up sent from this
  screen reaches the same conversation (checked against the API); a reload shows those messages as stored
  ones; Delete asks first, and afterwards the API answers 404 for that conversation.

By hand: send a message in Chat mode, follow its id here and carry the conversation on — the reply should
use the earlier turns. Then delete it and reload the playground: it starts a fresh conversation.

## Out of scope and follow-ups

Renaming a conversation (no route), feedback on a reply (an answers-only route) and searching the list
(the API has no search on conversations). A conversation's own usage and cost will come with the usage
screen.

## Docs updated

`README.md` (the conversations screen).
