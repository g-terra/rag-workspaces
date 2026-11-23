---
title: Wait for a chat reply to be stored in the e2e tests
date: 2026-11-23
pr: "#74"
status: in review
areas: [admin]
---

# Wait for a chat reply to be stored in the e2e tests

## Summary

Two admin UI Playwright tests failed some of the time: the playground chat test, and the conversations
page test. Both read a conversation from the API as soon as the reply's first words appeared, before the
API had stored the reply. They now wait for the reply's meta line instead, which only shows once the
stream has ended and the reply is stored. No app code changes.

## Why

The race failed CI on pull requests that don't touch chat (#72 at 0445f4d,
`e2e/playground.spec.ts:167`). Locally, `conversations.spec.ts` failed 2 runs out of 3.

## Design

`ConversationService.send` (`apps/api/src/services/conversations.ts`) inserts the assistant message and
sets the conversation's title only after generation finishes. The stream's `done` event carries that
stored message. In the admin UI, `TurnView` (`apps/admin/src/playground/chat-view.tsx`) shows
`data-testid="reply-meta"` only once `turn.reply` is set from `done`. The tests waited for
`data-testid="reply"` to be non-empty, which is true from the first token. So the follow-up
`GET …/conversations/{id}` could see `['user', 'assistant', 'user']`, and opening the conversation could
find no title yet.

The fix is in the tests:

- `apps/admin/e2e/playground.spec.ts` waits for two `reply-meta` lines before reading the thread.
- `apps/admin/e2e/conversations.spec.ts` waits for `reply-meta` before opening the conversation, and
  again before reading the thread after the follow-up.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Wait in the tests for the end of the stream | Store the assistant message before streaming and update it at the end | The API's behaviour is right: a reply is stored when it is complete. The tests made a wrong assumption about timing. |
| Wait for the meta line | Poll the API until four messages exist | The meta line is what a person sees when the reply is done, and it needs no extra request. |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

`pnpm e2e conversations.spec.ts playground.spec.ts` with `--repeat-each 3` passed 9 out of 9. Before
the fix, `conversations.spec.ts` failed 2 runs out of 3.

## Out of scope and follow-ups

None.

## Docs updated

None needed: only tests change.
