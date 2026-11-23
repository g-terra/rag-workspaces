---
title: Usage analytics per workspace and overall
date: 2026-11-20
pr: '#26'
status: merged
areas: [api]
---

# Usage analytics per workspace and overall

## Summary

Five usage reports read the request log: summary, timeseries, top questions, top documents and the raw
request list. Each exists overall at `/v1/usage/...` (admins) and per workspace at
`/v1/workspaces/{slug}/usage/...` (that workspace's editors and admins), over a `from`/`to` range that
defaults to the last 7 days. (Replaces #24, closed by a stack move.)

## Why

The brief's "analytics on API usage", built on the usage log (#22).

## Design

1. `apps/api/src/services/analytics.ts`: one function per report, SQL through Drizzle; `topDocuments` is
   raw SQL (unnests cited document ids); `rangeOf` validates `from < to`; timeseries buckets use UTC
   `date_trunc`; token sums are `bigint`.
2. `apps/api/src/routes/usage.ts`: routes defined once, registered for both scopes; only the access check
   differs.
3. `packages/shared/src/usage.ts`: response shapes, with comments on what each number means.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Errors = 5xx; 4xx counted as `clientErrors` | All non-2xx are errors | A client bug doesn't look like an outage |
| Questions = asking routes not refused with 4xx | Count by question text | Still counts after text retention clears it |
| Feedback from the answers table | From the log | A rating changes an answer, not a request |
| Analytics requests are logged too | Exclude `/v1/usage` | Accurate; a one-line change if unwanted |
| `percentile_cont` over the range | Pre-aggregated tables | Fine at this scale |
| Editors see question text in their workspace | Admins only | Plan wording; open question to the owner |

## Interfaces and contracts

- **HTTP API**: for both prefixes:
  - `summary`: requests, server and client errors, error rate, p50/p95 latency, questions, ungrounded,
    tokens, thumbs up/down;
  - `timeseries?interval=hour|day&groupBy=route|apiKey|user|workspace`;
  - `top-questions?limit=` (grouped ignoring case and spaces);
  - `top-documents?limit=`;
  - `requests?route=&status=&apiKeyId=&userId=&limit=&cursor=`.

  All take `from` and `to` (ISO); `from >= to` → 400. Readers and reader keys → 403; editors → 403 on
  the overall routes.
- **Configuration**: None.
- **Data**: reads `api_requests` and `answers`.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Deleted workspaces appear in the overall view only.

## Testing

`apps/api/src/routes/usage.test.ts` inserts known rows in a fixed past window and checks every number;
per-workspace reports only cover that workspace; readers 403 on the request log; editors 403 on global
routes. Live: summary counted an earlier answer (371 ms); top documents named the cited PDF.

## Out of scope and follow-ups

Dashboard in the admin UI (M4). Decision on editors seeing question text.

## Docs updated

None needed: `docs/api-schema.md` already listed the usage resources.
