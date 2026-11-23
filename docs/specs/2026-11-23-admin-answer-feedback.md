---
title: Rating a playground answer
date: 2026-11-23
pr: "#57"
status: in review
areas: [admin]
---

# Rating a playground answer

## Summary

Under a finished answer, the playground asks "Was this helpful?" with a thumbs up and a thumbs down.
Either one rates the answer at once (`POST /v1/workspaces/{slug}/answers/{answerId}/feedback`), and a
thumbs down then offers an optional comment to send with it. The rating that comes back is shown as
pressed, with "Thanks, feedback saved" (or "…feedback and comment saved"), and a refused rating shows
the API's reason with the buttons still usable. Completes the playground's Ask mode after
`2026-11-23-admin-playground-ask.md` and `2026-11-23-admin-answer-citations.md`.

## Why

Milestone M4, and the owner's ask. Without feedback there is nothing to tell a good answer from a bad
one later: the API stores the rating on the answer and the usage analytics count it
(`2026-11-20-answers.md`, `2026-11-20-usage-analytics.md`). Layout and copy follow the approved
"Playground" mock's feedback row, including the comment box appearing only after a thumbs down.

## Design

1. **The body** (`src/playground/feedback.ts`). `feedbackBody(rating, comment)` trims the comment, sends
   `null` rather than an empty string when there is nothing in it, and cuts it at the 2000 characters
   the API's `Feedback` schema accepts, so a long paste is shortened instead of refused.
   `feedbackNote(feedback)` is the line shown afterwards, read from the answer the API returned rather
   than from what was pressed, so it only appears once the rating is actually stored.
2. **The request** (`src/playground/queries.ts`). `useAnswerFeedback(slug)` posts the body and returns
   the updated answer. Rating again replaces the earlier rating, which is what pressing the other thumb
   does, and what sending a comment after a thumbs down does: the comment is sent as a second rating
   with the same `rating` value.
3. **The answer on screen** (`src/playground/ask.ts`, `use-ask.ts`). A new `rated` event replaces the
   answer in `AskState` with the one the API returned, and only when its id matches the answer on
   screen, so a rating that arrives after a new question was asked is dropped instead of showing
   someone else's feedback. It is the one event that is not about the running stream, so it is handled
   before the reducer's "only while streaming" guard.
4. **The row** (`src/routes/playground.tsx`). `AnswerFeedback` shows the two thumbs as
   `aria-pressed` buttons labelled "Helpful" and "Not helpful", disabled while a rating is in flight.
   The comment box (an `Input` labelled "Feedback comment") appears while the stored rating is `down`,
   with Send disabled until something is typed. A failure shows the API's message in the row. The row
   also sits under a "Not found in this workspace" answer, which the API stores like any other: a
   question the workspace should have covered is exactly the one worth flagging.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Rate at once, comment after | Collect the comment first, then send one request | A rating is the cheap signal and most people stop there; the API is built for rating again |
| Show the rating from the API's answer | Keep what was pressed in local state | What the next person reads is what the API stored, not what the browser remembers |
| Drop a rating whose answer is no longer on screen | Apply it anyway | Otherwise a slow rating would attach a thumb to the next question's answer |
| Cut a long comment at 2000 characters | Let the API refuse it with a 400 | The limit is the API's, and losing a long comment to a validation error is worse than shortening it |
| Comment only after a thumbs down, and only sent with one | Send whatever is in the box with either thumb | Changing your mind to "Helpful" would otherwise store the thumbs-down explanation under it, where the box that shows it is no longer displayed |
| A "not found" answer can be rated too | Only rate generated answers | It is stored with an id and counted in usage, and it is the answer most worth flagging |
| No "undo" | A third state that clears the rating | The API has no way to remove feedback; pressing the other thumb is the correction |

## Interfaces and contracts

- **HTTP API**: None changed. The UI calls `POST /api/v1/workspaces/{slug}/answers/{answerId}/feedback`
  with `{ rating, comment }`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Existing installs: `docker compose up -d --build web`. A rating overwrites the previous one on the same
answer, which the API has always done.

## Testing

- `apps/admin/src/playground/feedback.test.ts`: the body with a trimmed comment, with an empty one,
  with a comment under a thumbs up (left out), and with one over the API's limit — which is checked
  against `Feedback` from `@rag/shared`, so lowering the limit there fails this test rather than
  reaching a person as a `400`; the note before and after a rating, with and without a comment.
- `apps/admin/src/playground/ask.test.ts`: a `rated` event replaces the answer, and is ignored when its
  id is not the answer on screen.
- `apps/admin/e2e/playground.spec.ts` (real stack): after the streamed answer, presses "Not helpful",
  sees the saved note and `aria-pressed`, types a comment, sends it, sees the comment note, and then
  reads `GET …/answers/{id}` to check the API stored `rating: down` with the trimmed comment. It also
  rates the "not found" answer in the strict workspace.

By hand: rate an answer, then press the other thumb and check that the first rating is replaced (and
the comment box appears or goes). Rate an answer from another browser session to see a `404` reported in
the row, since an answer is visible only to the caller who asked and to admins.

## Out of scope and follow-ups

Rating conversation messages (the API stores feedback on answers only). Showing earlier ratings, which
belongs with usage analytics. Removing a rating.

## Docs updated

None needed: `README.md` describes the playground, and feedback changes nothing it states.
