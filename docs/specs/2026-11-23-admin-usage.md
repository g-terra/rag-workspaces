---
title: Usage analytics in the admin UI
date: 2026-11-23
pr: "#60"
status: in review
areas: [admin, api]
---

# Usage analytics in the admin UI

## Summary

The same analytics screen twice: `/usage` for admins (every workspace) and `/w/<slug>/usage` for a
workspace's editors and admins, matching the two scopes the API already serves. It shows five summary
tiles (requests, error rate, p50/p95 latency, tokens, questions and feedback), requests and p95 latency
over time, requests by route, the most asked questions, the most cited documents, and the raw request log
with route and status filters and paging. The range picker (24 hours, 7, 14 or 30 days) opens on the last
7 days and scopes everything below it. Charts are plain HTML and one SVG polyline — no charting library.
`packages/shared/src/usage.ts` gains the inferred TypeScript types for the shapes the UI reads.

## Why

Milestone M4 in `docs/work-breakdown.md` ("usage analytics (global and per workspace)"). The routes have
existed since `2026-11-20-usage-analytics.md`; until now the only reader was Swagger. Layout and copy
follow the approved "Usage analytics" mock. Charts follow the `dataviz` skill.

## Design

1. **Routes and nav** (`src/router.tsx`, `src/components/app-layout.tsx`,
   `src/components/workspace-nav.tsx`). `usage` is a child of `AppLayout` (global) and of `w/:slug`
   (workspace). One `Usage` component picks the scope from the route match, so both read the same
   markup. The admin nav's "Usage" shows only for admins, and the workspace nav's only when
   `access !== 'reader'` — what the API demands (`requireWorkspace(..., 'editor')`). Reaching either URL
   without the role shows a notice rather than five failed requests.
2. **The slice** (`src/usage/range.ts`, `src/routes/usage.tsx`). `rangeFor()` turns a range key into
   `from`/`to`; `intervalFor()` buckets a day by the hour and anything longer by the day. The page holds
   `range` **and** `now` in one piece of state, so every card asks about exactly the same slice and a
   re-render never moves the window; picking a range anchors a new "now". `range.ts` also holds the
   formatters (counts, "84 ms"/"1.8 s", percentages, "2.1 M", the status tone, UTC bucket labels, and a
   logged request's day and time) and `statusFilter()`, which withholds a status code until it is a whole
   one: `?status=` is `min(100).max(599)`, so sending "4" on the way to "418" would answer 400 and blank
   the log mid-keystroke.
3. **Requests** (`src/usage/queries.ts`). `useUsage()` runs the five card queries (summary, timeseries,
   timeseries grouped by route, top questions, top documents) under keys starting
   `['usage', base, …, from, to]`, where `base` is `/v1/usage` or `/v1/workspaces/<slug>/usage`.
   `useRequestLog()` is separate, because its filters and cursor change without touching the cards.
   Every query keeps the data it is showing while the next slice loads (`placeholderData:
   keepPreviousData`) and the card fades on `isPlaceholderData`, so nothing collapses and jumps back.
   The timeseries query returns its own `from`/`to`/`interval` with the points, so a held chart's axis
   always describes the points drawn on it.
4. **Chart data** (`src/usage/chart.ts`, no React, unit-tested).
   - `fillBuckets()` adds the buckets the API leaves out (it only returns buckets that saw traffic), so
     a week with one busy day draws seven columns, not one, and the axis labels span the real range. A
     rolling window over calendar buckets makes the first and last bucket partial (a "7 days" range at
     10:30 starts mid-day and ends mid-day); both are kept, because dropping either would hide requests
     the range and the tiles do count.
   - `niceMax()` puts the axis top at 1, 2 or 5 times a power of ten (at least 1, so an all-zero series
     doesn't divide by zero); `axisTicks()` gives top/middle/zero; `barHeights()` gives each column its
     height as a percentage.
   - `linePoints()` builds the latency polyline in a 0–100 box, skipping buckets with **no** measurement
     rather than drawing them at zero, and drawing no line at all below two measurements;
     `soleMarker()` puts a dot where the single measured bucket is, so one quiet week cannot look like a
     week-long latency level.
   - `totalsByGroup()` sums the grouped timeseries per route over the range; `topGroups()` keeps the
     seven busiest and folds the rest into one "Other (N routes)" row. `routePaths()` lists the route
     patterns seen in the range for the log's filter, dropping the method because `?route=` matches a
     whole pattern.
5. **The charts** (`src/components/usage-charts.tsx`). Columns are flex `div`s (percentage heights, 4px
   rounded top, capped at 24px, a 2px gap), the line is one SVG `polyline` with a non-scaling 2px
   stroke, and the latency chart carries a crosshair column per bucket. One series each, so there is no
   legend: the card title names what is plotted. Each chart has `role="img"` with a summarising
   `aria-label`, a live readout of the hovered (or latest) bucket, and a visually hidden table of every
   bucket, so no value is reachable only by hovering. The series colour is the `--chart-1` token, with
   its own step chosen for dark mode (`src/index.css`); both steps were checked with the `dataviz`
   skill's palette validator against the light and dark card surfaces.
6. **The request log** (`src/routes/usage.tsx`). Newest first, 25 a page, with a Route select (the
   patterns seen in the range) and a status box. Paging keeps a stack of the cursors already used, so
   "Newer" goes back without asking the API for a cursor it never gives. The whole log is keyed by the
   slice, so changing the range starts again at page 1 with no filter: a cursor is a row id from the
   old window and a route may not exist in the new one. Each row carries its day **and** time in UTC
   (a 7-day log of bare clock times tells you nothing), its status in the tone `statusTone()` gives it,
   and the caller id truncated with the full id in its `title`.
   Each of the five cards shows its own loading, failure (with a retry) and "nothing in this range"
   state, so a card that failed can never be mistaken for a card with nothing in it. When the summary
   says the range holds no requests at all, the charts give way to one notice instead of drawing two
   empty boxes with a meaningless axis.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Plain HTML and one SVG polyline | Recharts, Chart.js, visx, d3 | Two single-series charts don't pay for 50–200 kB, a second render model and a dependency to keep patched; the geometry that matters is 60 lines and unit-tested |
| Fill missing buckets in the browser | Ask the API to fill them | The UI already knows the range and the interval; the API stays a straight aggregate |
| Fold routes past the seventh into "Other" | List every route | A real API has thirty routes; thirty bars are unreadable and the tail says nothing anyone can act on |
| A dot, not a line, for a single measurement | Flat line across the box | A level held across days nothing was measured in is the false floor this chart is trying to avoid |
| Latency gaps skipped, not zeroed | `?? 0` | A bucket with no requests has no percentile; 0 ms reads as an instant answer |
| One component for both scopes | A page each | The API serves the same five shapes either way; the only difference is the prefix and who may read it |
| Range **and** `now` in one state | A fresh `new Date()` per render | Cards would each ask about a slightly different window and the charts would shift under the reader |
| Route filter as a select of seen patterns | A free-text box | `?route=` matches a whole pattern (`eq`), so a typed substring silently returns nothing |
| Cursor stack for paging | Infinite scroll, append-on-"Load more" | The log is for looking something up, not for reading through; a stack makes "Newer" exact and keeps one page in memory |
| Inferred types exported from `@rag/shared` | `z.infer<typeof …>` in the admin app | The package is the API contract; the API keys and workspace schemas already export their types |
| Keep both partial end buckets | Drop the partial first bucket | A dropped bucket hides requests the summary tiles still count; a short first column is honest about a rolling window |
| Hold the previous slice, faded | Let cards unmount while the next slice loads | The page would collapse and jump back on every range change; the series carries its own slice, so a held chart is never mislabelled |
| Withhold a half-typed status code | Debounce; validate on blur | `?status=4` is a 400, and the log would flash its error state twice on the way to "418" |
| The log restarts on a range change | Keep the page and filter | A cursor is a row id from the old window, and a route pattern may not exist in the new one; keeping either shows an arbitrary slice under a confident "Page 3" |

## Interfaces and contracts

- **HTTP API**: none changed. The UI reads `GET /api/v1/usage/{summary,timeseries,top-questions,top-documents,requests}`
  and the same five under `/api/v1/workspaces/{slug}/usage`, with `from`, `to`, `interval`, `groupBy`,
  `limit`, `route`, `status` and `cursor`.
- **Configuration**: none.
- **Data**: none.
- **Langflow**: none.
- **Events and logs**: none.
- **Shared package**: `packages/shared/src/usage.ts` now exports the types `UsageSummary`,
  `TimeseriesPoint`, `Timeseries`, `TopQuestions`, `TopDocuments` and `RequestLogEntry` beside the
  schemas (the other modules already did).

## Operations

Existing installs: `docker compose up -d --build web`. Nothing to migrate. Questions older than the
retention period stop counting in "Top questions" (`2026-11-20-usage-log.md`), so the card can shrink on
its own.

## Testing

- `apps/admin/src/usage/range.test.ts` (11 cases): the four ranges' boundaries, hour vs day buckets, the
  formatters (including `null` latency and a zero error rate), the log's day-and-time, which typed
  status codes are sent, the status tones, and UTC bucket labels.
- `apps/admin/src/usage/chart.test.ts` (20 cases): `niceMax` (including an empty and an all-zero series),
  bar heights without dividing by zero, axis ticks, polyline points over bucket centres, with gaps and
  in the no-line cases, `soleMarker`, bucket filling for days and hours and for a range with no traffic
  at all, route paths (methods collapsed, groupless points skipped), and grouped totals with the
  "Other" fold.
- `apps/admin/e2e/usage.spec.ts` (real stack): a throwaway workspace is asked one question through the
  API, then its Usage page is opened from the workspace nav and shows the tiles, both charts (by their
  `role="img"` labels), the question among the top questions, the answers route, and the request in the
  log; a status nobody sent empties the log and clearing it brings the rows back; the Route select
  filters to the answers route; paging starts on page 1 with "Newer" disabled; switching to 24 hours
  re-buckets the chart by hour. A second test opens the admin-wide page. The workspace is deleted
  afterwards.

By hand: as an editor (not an admin), check that `/w/<slug>/usage` loads and `/usage` says admins only,
and that "Usage" is absent from a reader's workspace nav.

## Out of scope and follow-ups

From the mock: "Export CSV" (no route), the "+18% vs previous period" deltas (they need a second range
query the API would have to serve), the Workspace select (usage is scoped by route, so the workspace's
own page is that filter) and the Caller select (there is no `/v1/users`, and key names are admin-only).
Also not here: a "Table view" toggle on the route card (the hidden table already carries the chart
values), per-caller breakdowns, and feedback detail beyond the tile's counts.

## Docs updated

`README.md` (usage analytics in the admin UI) and `docs/api-schema.md` (the usage table now names the
screen that reads these routes).
