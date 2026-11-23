---
title: Stream answers token by token
date: 2026-11-20
pr: '#20'
status: merged
areas: [api, langflow-client]
---

# Stream answers token by token

## Summary

The same `POST /v1/workspaces/{slug}/answers` streams the reply as server-sent events when the caller
sends `Accept: text/event-stream`: `token` events as the model writes, then `citations`, then `done` with
the stored answer. The stream opens only on the first token, so failures before that are normal HTTP
errors.

## Why

The admin UI playground and chat need text as it is generated; local models are slow enough that a
multi-second wait for the whole answer feels broken.

## Design

1. `apps/api/src/services/answers.ts`: `ask` takes optional `onToken` and `signal`; private `stream()`
   reads Langflow's stream (`/api/v1/run?stream=true`): `token` → text, `error` → throw, `end` → the same
   result a plain run returns. Measures time to first token.
2. `packages/langflow-client`: `stream()`.
3. `apps/api/src/routes/answers.ts`: streaming branch; opens the SSE response on the first token;
   `try`/`catch`/`finally` always ends it, sending an `error` event for failures after it opened.
4. `apps/api/src/sse.ts`: shared stream-opening code (moved from the documents route).
5. Client disconnect aborts the Langflow run.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Open the stream on the first token | Open immediately | Errors before any text keep real status codes (502/503) |
| Abort the run when the caller leaves | Let it finish | Saves local GPU time; the answer is stored as failed |
| Citations at the end | Before the text | Langflow only hands over the citations output in its final event |
| Ungrounded answer streams as one token | Different path | One client code path |

## Interfaces and contracts

- **HTTP API**: `POST /v1/workspaces/{slug}/answers` with `Accept: text/event-stream` → events:
  - `token` `{ text }`, many times;
  - `citations` `{ citations }`;
  - `done`: the stored answer, with `timeToFirstTokenMs`;
  - `error`: problem JSON plus `answerId`.
- **Configuration**: None.
- **Data**: fills `answers.time_to_first_token_ms`; abandoned runs stored as failed with "The caller left
  before the answer finished."
- **Langflow**: streaming run endpoint; chat outputs must be `ChatOutput-*` for tokens to stream (POC
  finding).
- **Events and logs**: as above.

## Operations

Clients must handle both an HTTP error status and an `error` event. Through nginx tokens arrive
unbuffered (checked on 8080).

## Testing

Stream tests at the end of `apps/api/src/routes/answers.test.ts`: token, citations and done order;
error before the first token is a status code; unexpected error after the first token ends with an
`error` event; client disconnect mid-stream on a real socket stores a failed answer.

## Out of scope and follow-ups

Conversations reuse this (#21, `routes/streaming.ts`).

## Docs updated

None needed: `docs/api-schema.md` already described streaming answers.
