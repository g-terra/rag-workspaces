---
title: read fullwidth 【n】 citations as citation chips
date: 2026-11-23
pr: "#77"
status: in review
areas: [admin]
---

# Read fullwidth 【n】 citations as citation chips

## Summary

The admin UI now turns `【5】`, `【1, 2】` and `【5†L3-L5】` into the same clickable citation chips as
`[5]`. Before this, those markers showed as plain text. The stored answer text is not changed.

## Why

During the course-material load on 2026-11-23, `openai/gpt-oss-20b` (the default chat model on
Guilherme's machine) sometimes cited passages in its own house style, `【5】`, instead of the `[n]` that
the system prompt asks for. Those answers showed no chips, so their sources couldn't be opened from the
text. Builds on `2026-11-23-admin-answer-markdown.md`.

## Design

`apps/admin/src/playground/answer.ts`: `MARKER` matches either `[n, m]` or `【n, m】`, with an
optional `†locator` before the closing bracket, which is dropped. Everything else stays as it was:
- a rank must have a citation;
- a marker attached to a word on its left (`items[1]`) stays text;
- markers in code stay text, because the markdown renderer only splits text nodes.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Read both forms in the UI | Rewrite `【n】` to `[n]` in the API before storing; tighten the system prompt | The stored text stays exactly what the model wrote, and API clients may want it as is. The prompt already asks for `[n]`, and gpt-oss ignores that some of the time |
| Drop the `†…` locator | Show it next to the chip | It points into the model's own view of the context, which means nothing to a reader |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

`apps/admin/src/playground/answer.test.ts`: `【1】` and `【1, 2】` become chips, `【2†L3-L5】` becomes chip 2,
and a fullwidth rank with no citation stays text. By hand: ask gpt-oss-20b a question until it answers
with `【n】`, and check that the chips open their passages.

## Out of scope and follow-ups

MCP and API clients still get the raw text. Normalising it on the server is possible later, if an
agent needs it.

## Docs updated

None needed.
