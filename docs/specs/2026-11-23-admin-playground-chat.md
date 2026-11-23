---
title: Chat mode in the admin playground
date: 2026-11-23
pr: pending
status: proposed
areas: [admin]
---

# Chat mode in the admin playground

## Summary

The playground gains its third and last mode: Chat. The first message creates a conversation (`POST
/v1/workspaces/{slug}/conversations`) and every message streams its reply from `POST
…/conversations/{id}/messages`, so a follow-up is answered with the earlier turns in view. Each reply
cites its passages the way an answer does, and a citation opens the same passage preview. "New
conversation" starts an empty thread. Follows `2026-11-23-admin-playground-search.md`; the conversations
screen, which lists what this mode stores, is the next PR in this stack.

## Why

Milestone M4, and the owner's ask. Chat is the call agents make for anything multi-turn, and it behaves
differently from a single answer: the API keeps the history, the retrieval also uses your previous
question, and a reply belongs to a conversation that outlives the page. Trying that here, against a real
workspace, is how you tell whether a follow-up is understood before an agent depends on it. Layout and
copy follow the approved "Playground" mock's Chat panel.

## Design

1. **The thread** (`src/playground/chat.ts`). `ChatTurn` is one exchange: the question, the reply text as
   it streams, the stored `Message` once it arrives, an error, and a status (`streaming`, `done`,
   `failed`, `stopped`). `chatReducer` appends a turn on `sent` and then only ever changes the newest
   one, and only while it is streaming, so events still in flight after Stop are ignored — the same rule
   `askReducer` follows. `cleared` empties the thread for a new conversation.
2. **The requests** (`src/playground/use-chat.ts`). `useChat()` keeps the conversation id in a ref, so
   the first message creates the conversation and every later message reuses it without waiting for a
   render. The reply streams through the existing `streamGeneration()` with `Message` as the `done`
   shape; nothing in that module was chat-specific. A 503 refetches the workspace, as Ask does, so the
   reindexing copy is right. Aborting mid-create leaves an empty conversation, which costs nothing.
3. **The panel** (`src/playground/chat-panel.tsx`). The thread is above the box, as the mock has it:
   your message in a bubble, the reply in a card with its meta line and its sources beside it. The box is
   the shared `QuestionBox`, labelled "Message" and then "Follow-up", with the conversation's id and
   "New conversation" in its footer. Stop replaces Send while a reply streams.
4. **What Ask and Chat share** (`src/playground/answer-view.tsx`). The pieces both modes render moved out
   of `ask-panel.tsx` unchanged: `AnswerText` (the text with its `[n]` markers as buttons, and the
   caret), `Sources` and `AnswerFailure`. `answerMeta()` now takes a nullable latency and an optional
   provider, which is what a `Message` carries.
5. **The tab** (`src/playground/search.ts`, `src/routes/playground.tsx`). A third entry in `MODES` and a
   third hidden panel; `?mode=chat` is now a mode `parseMode()` accepts.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| The conversation is created by the first message | Create one when the tab opens | Opening a tab should not leave empty conversations behind in the list the next PR shows |
| The conversation id in a ref, not only in state | Read it from state in `send` | Two messages sent quickly would otherwise create two conversations |
| Reuse `streamGeneration` | A second streaming reader for messages | The events are the same four; only the `done` shape differs, which is already a parameter |
| Only the new message is sent | Send the whole thread each time | The API keeps the history (`CHAT_HISTORY_TURNS`) and is the thing being tried out here |
| A failed turn offers "Try again" | Retry in place | Retrying sends a new message, which is what the API offers; the failed turn stays visible above it |
| No rating on a reply | Thumbs on each reply | Feedback is an answers route; the API has none for messages |
| `answerMeta` takes a nullable latency | A second formatter for replies | A reply reports the same three things, and may report none of them |
| Shared pieces in `answer-view.tsx` | Chat imports them from `ask-panel.tsx` | A panel importing another panel's internals; the move is behaviour-preserving |

## Interfaces and contracts

- **HTTP API**: None changed. The UI calls `POST /api/v1/workspaces/{slug}/conversations` and `POST
  …/conversations/{id}/messages` with `Accept: text/event-stream`.
- **Configuration**: None.
- **Data**: None. Conversations and messages are stored by the API, as before.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Existing installs: `docker compose up -d --build web`. `/w/<slug>/playground?mode=chat` is a new link
shape; any other value of `mode` opens Ask. Chat mode writes conversations, which the owner of the
conversation (and admins) can delete through the API; the screen for that is the next PR.

## Testing

- `apps/admin/src/playground/chat.test.ts`: a turn opens on `sent`; tokens append to the turn being
  answered; the stored reply's content replaces the streamed text, and does not when it is `null`; a
  failure keeps what arrived; events after `stopped` are ignored; earlier turns are untouched; `cleared`
  empties the thread; `lastTurn()` of an empty chat.
- `apps/admin/src/playground/answer.test.ts`: `answerMeta()` for a reply, which has no provider, and for
  one that reported nothing at all.
- `apps/admin/src/playground/search.test.ts`: `parseMode('chat')`.
- `apps/admin/e2e/playground.spec.ts` (real stack): opens `?mode=chat` directly, sends a question and
  sees the reply stream in with its id, meta line and one source; sends a follow-up and sees two turns in
  one conversation; reads the conversation back from the API and finds both sides of both turns; switches
  to Ask and back to prove the thread is not lost; starts a new conversation and gets a different id.

By hand: ask a question, then ask "why?" on its own — the reply should answer the first question, which
is what the kept history buys. Stop a reply mid-stream and send another message: the conversation
continues, and the API stored the whole reply you stopped reading.

## Out of scope and follow-ups

The conversations screen (list, detail, delete, and a link from here) is the next PR. Left out of the
mock: renaming a conversation (the API takes a title only when the conversation is created) and feedback
on a reply (an answers-only route).

## Docs updated

`README.md` (the playground's three modes).
