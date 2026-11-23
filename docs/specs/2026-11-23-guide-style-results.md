---
title: point the user guide at the response style measurements
date: 2026-11-23
pr: "#128"
status: in review
areas: [docs]
---

# Point the user guide at the response style measurements

## Summary

`docs/guide/playground.md` gains a short paragraph in "Response styles" that summarises the measurements
added to `docs/tuning.md` (#126) and links them: every style cites, `concise` was the only one with no wrong answer, and
`talkative` sometimes answers uncovered questions instead of refusing. Also marks the previous guide
follow-up spec merged. No code changed.

## Why

People pick a style in the playground and settings without reading the tuning notes. The one behaviour
that changes what an answer may say (talkative not refusing) belongs where the choice is made. Builds on
2026-11-23-style-measurements.md.

## Design

One paragraph before the picker description, linking `../tuning.md#response-styles` for the numbers.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Summarise and link | Copy the table into the guide | One home for the numbers; they change when the styles are re-measured |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

Docs only. The summary matches the table and notes in `docs/tuning.md`; the anchor resolves.

## Out of scope and follow-ups

Changing talkative's instructions so it refuses uncovered questions is the tuning thread's follow-up.

## Docs updated

`docs/guide/playground.md`.
