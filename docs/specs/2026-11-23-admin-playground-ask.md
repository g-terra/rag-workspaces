---
title: Ask a workspace a question in the admin playground
date: 2026-11-23
pr: pending
status: proposed
areas: [admin]
---

# Ask a workspace a question in the admin playground

## Summary

`/w/<slug>/playground` is a new screen, linked from the sidebar's "Workspace" section for every access
level, where you type a question and watch the answer arrive word by word. It posts `POST
/v1/workspaces/{slug}/answers` with `Accept: text/event-stream` and shows each `token` event as it
comes, then the stored answer's id and a meta line (latency, model, token counts). Stop aborts the
request and keeps what had arrived. An answer that found nothing relevant (`grounded: false`) becomes a
"Not found in this workspace" card instead, and a refusal or a mid-stream failure shows the API's own
reason. Citations and feedback are the next two PRs in this stack.

## Why

Milestone M4 in `docs/work-breakdown.md`, and the owner's ask: people should be able to ask questions in
the UI, not only through the API. The routes and their streaming contract are specified in
`2026-11-20-answers.md` and `2026-11-20-answer-streaming.md`. Layout and copy follow the approved
"Playground" mock.

## Design

1. **Route and nav** (`src/router.tsx`, `src/components/workspace-nav.tsx`). `playground` is a child of
   `/w/:slug`, so it gets the loaded workspace through `useCurrentWorkspace()`. The nav entry shows for
   readers too, because asking needs only read access.
2. **Streaming** (`src/playground/stream.ts`). `streamGeneration()` posts the body with
   `Accept: text/event-stream` through `sendAuthorized()` (bearer token, renew once on a 401), then reads
   `res.body` through `TextDecoderStream` and the SSE parser, calling `onToken` for each `token` event
   and returning one of three outcomes: `done` with the stored record, `failed` with a reason and the
   stored record's id, or `aborted`. It is written once for answers and conversation messages, so the
   `error` event's id field is a parameter (`idKey`: `answerId` or `messageId`). The `citations` event is
   ignored, since the `done` record carries the same citations.
   `fetch` rather than `EventSource`: `EventSource` can send neither a bearer token nor a request body.
   Three failure paths are kept apart on purpose: a refusal before the stream opens is a normal HTTP
   response, so its problem JSON is read (503 while Langflow restarts, 502 when the provider is down, 404
   for a workspace you cannot see); a failure after the first token can only arrive as an `error` event;
   and a stream that ends with neither `done` nor `error` is reported as a failure rather than left
   looking like a complete answer.
3. **Shared helpers** (`src/api/sse.ts`, `src/api/problem.ts`). The parser moves out of `src/documents/`
   because two features now read it, with its tests unchanged. `failureDetail()` moves out of
   `upload.ts` beside a new `problemDetail(res)`, which `createApiClient()` also uses instead of its own
   copy of the same fallback rules.
4. **State** (`src/playground/ask.ts`, `use-ask.ts`). `askReducer()` holds one asked question: the text
   so far, the stored answer, or the failure. Everything after `stopped` is ignored, because an aborted
   stream's last events can still be in flight and the person asked for them to stop. `useAsk()` keeps an
   `AbortController` per question, aborts the previous one when a new question is asked, and aborts on
   unmount so no tokens arrive for a screen that is gone.
5. **The page** (`src/routes/playground.tsx`). The question box is a textarea (`Ctrl`/`Cmd`+`Enter`
   submits) with a passage count (5, 3 or 8 → `maxPassages`) and one button that is Ask, or Stop while
   streaming. The answer card shows a blinking caret while tokens arrive, then the answer id in mono and
   `answerMeta()`. `grounded: false` replaces it with the mock's "Not found in this workspace" card,
   which repeats the question and links to Upload. A failure shows a `Notice` with the API's detail and
   a "Try again" button. The page is keyed by workspace slug, so one workspace's answer can never show
   under another's name.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| `fetch` + the existing SSE parser | `EventSource` | `EventSource` cannot send a bearer token or a body; the parser already exists and is tested |
| Move `sse.ts` to `src/api/` | Import it from `@/documents/` | Two unrelated features read it now; a feature folder importing another feature's internals hides that |
| One `streamGeneration()` for answers and messages | A copy per route | The two streams differ only in the id the `error` event carries |
| Ignore the `citations` event | Render sources from it | The `done` record that follows it immediately carries the same citations |
| Ignore events after Stop | Keep the last token that races in | Stop means stop; the API still stores the whole answer, which the stopped note says |
| Keep the partial text after a failure | Clear it and show only the error | The text already read is what the person saw; hiding it looks like a bug |
| A stream ending without `done` is a failure | Treat the text as the answer | A dropped connection must not look like a finished answer |
| Passage count as a fixed 5/3/8 choice | A number input, or leave it to the workspace | Matches the mock, and the API caps it at 20 anyway |
| No mode tabs yet | Ship the Ask/Chat/Passages tabs disabled | Rule 1: the tab group lands with the second mode |

## Interfaces and contracts

- **HTTP API**: None changed. The UI calls `POST /api/v1/workspaces/{slug}/answers` with
  `Accept: text/event-stream` and a `{ question, maxPassages }` body, with the bearer token.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None new. The UI reads the `token`, `done` and `error` events of a streamed
  answer, and ignores `citations`.

## Operations

Existing installs: `docker compose up -d --build web`. Nothing to undo: asking only reads material, and
every answer is already stored by the API.

## Testing

- `apps/admin/src/playground/stream.test.ts`: the request's method, `Accept`, body and bearer token;
  tokens reported in order then the `done` record; an `error` event turned into a failure with its detail
  and `answerId`; the problem detail of a 503 before the stream opens; a stream ending without `done` or
  `error`; an aborted run; a 401 renewed once and then reported as an ended session.
- `apps/admin/src/playground/ask.test.ts`: a new question clears the previous answer; tokens append;
  `done` keeps the record and prefers its text, or keeps the streamed text when the record has none; a
  failure keeps the partial text and the reason; Stop keeps the partial text and ignores what follows.
- `apps/admin/src/playground/answer.test.ts`: the meta line with and without a model, a provider and
  token counts; durations in milliseconds, seconds and minutes.
- `apps/admin/src/api/problem.test.ts`: the detail of a problem response, and the fallback when the body
  is not JSON (moved from `upload.test.ts`, which only tested this).
- `apps/admin/e2e/playground.spec.ts` (real stack): creates two workspaces holding the same fixture, one
  with a loose relevance threshold and one with a strict one, because the stand-in model's hashed
  embeddings score far below a real model's and the threshold is what decides whether an answer is
  grounded. It waits for ingestion, opens Playground from the sidebar, asks a question and sees the text,
  the answer id and the meta line; asks again and presses Stop and sees the stopped note with Ask usable
  again; then asks the strict workspace the same question and sees "Not found in this workspace" with its
  Upload link. Both workspaces are deleted afterwards.

By hand: stop the stand-in model (or point `LMSTUDIO_BASE_URL` at nothing) and ask, to see the API's 503
reason in the failure notice. Ask while a workspace is reindexing to see the same path.

## Out of scope and follow-ups

Citations (the `[n]` markers, the sources list and the passage preview) and the thumbs up/down feedback
are the next two PRs in this stack; the Chat and "Passages only" modes follow with the mode tabs. Left
out of the mock on purpose: the folder filter (the API has no folders), the model pill above the button
(the model comes back with the answer, so it is in the meta line instead), "Show API call" (a curl
snippet the Swagger docs already give), and the "Check again" button on the model-down banner (there is
no health route to check).

## Docs updated

`README.md` (the playground in the admin UI).
