---
title: Count a reply that cites none of its passages as not grounded
date: 2026-11-23
pr: pending
status: in review
areas: [api, admin, mcp, docs]
---

# Count a reply that cites none of its passages as not grounded

## Summary

An answer or chat reply is now `grounded: true` only if its text cites at least one of the passages the
model was given (`[n]`, `[n, m]` or the fullwidth `【n】`). When the model reads its passages, finds nothing
to use and says so ("the material does not cover it"), the reply is `grounded: false`. Its text and its
citations (the passages it read) are kept. The admin UI shows such a reply with a note under it, instead of
the "nothing was close enough" card, which stays for the case where no model ran.

## Why

Guilherme's evaluation on the OUC material (2026-11-23) asked questions the material does not answer. Their
best passages still scored up to 0.60, so the 0.3 relevance threshold never stopped them. The model then
refused correctly, but the reply came back `grounded: true`, so usage counted it as answered and nothing
told a reader or an agent (MCP `ask`) that the material did not cover the question.

A similarity score cannot settle this. Passages about the same topic score well without holding the answer,
and raising the threshold far enough to stop those questions would also refuse real ones. Only the model,
having read the passages, knows whether it used them, and the system prompt already asks it to cite what it
uses. Whether it cited anything is a signal that works in any language and with any system prompt that asks
for citations.

## Design

1. `citesAny(text, ranks)` in `apps/api/src/services/generate.ts` finds citation markers with the same
   pattern the admin UI uses (`apps/admin/src/playground/answer.ts`) and checks that one of them is the rank
   of a passage the model was given. `Generator.generate` sets `grounded` from it for every completed reply,
   so answers, chat replies, their stream `done` events, usage logging and MCP `ask` all get it.
2. The no-hits path is unchanged: fixed text, empty citations, no model call, `grounded: false`.
3. Admin UI: `foundNothing(reply)` (`grounded: false` with no citations) decides when the Ask panel and the
   chat show the "not found" message. A `grounded: false` reply with citations shows its text and sources
   with the `UNCITED` note under it. The usage page labels the ungrounded count "not answered from the
   material" instead of "found nothing".
4. The stand-in model (`poc/standin/server.ts`) cites the first passage, as the system prompt asks, so the
   smoke and e2e stacks keep producing grounded answers.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Grounded means "cites one of its passages" | Match refusal phrases ("does not cover", "not mentioned") | Phrases depend on language, model and the workspace's own system prompt. Citations are what the prompt already asks for. |
| Same, rather than tuning `DEFAULT_MIN_SCORE` | A higher default threshold | Unanswerable questions scored up to 0.60 and answerable ones overlap that range. Threshold tuning for the OUC workspace is done separately, on Guilherme's machine, against the evaluation questions. |
| Keep the citations on an ungrounded reply | Drop them | They are the passages the model read. A reader can check that the refusal is right, and the passage that almost matched is useful. |
| A reply that answers but forgets to cite is ungrounded | Treat it as grounded | An answer that points at no passage cannot be checked against the material. The text is still shown, with the note. |

Risk: a model that writes correct answers without citation markers now gets every answer marked
`grounded: false`. The prompt asks for `[n]`, and the models tried so far cite. Some write fullwidth `【n】` markers, which count. A workspace with a custom system
prompt that drops the citation instruction would see this too.

## Interfaces and contracts

- **HTTP API**: the meaning of `grounded` on answers and conversation messages widens: `false` also when
  the reply cites none of its passages. Its type and the no-hits case are unchanged. Documented in the
  route description, `docs/api-schema.md` and `docs/api.md`.
- **Configuration**: None.
- **Data**: None. Stored answers keep the value they were stored with.
- **Langflow**: None.
- **Events and logs**: `api_requests.grounded` follows the new rule, so the usage summary's `ungrounded`
  count now includes uncited replies.

## Operations

None. Restart the API and the admin UI.

## Testing

- `apps/api/src/routes/answers.test.ts`: an uncited reply is stored and returned `grounded: false` with
  its text and citations; `【1†…】` counts; `[7]` with one passage does not.
- `apps/api/src/routes/conversations.test.ts`: an uncited chat reply is stored `grounded: false`.
- `apps/admin/src/playground/answer.test.ts`: `foundNothing` is true only with no citations.
- `pnpm smoke` and `pnpm e2e` on the stand-in stack.
- By hand: ask the OUC workspace an unanswerable question from the evaluation. The answer shows the
  model's refusal with the note, and the usage page counts it as not answered from the material.

## Out of scope and follow-ups

- Tuning `DEFAULT_MIN_SCORE` and the OUC workspace's settings (the separate answer-quality tuning work).
- Multi-part questions and list answers are a separate fix from the same evaluation.

## Docs updated

`docs/api-schema.md`, `docs/api.md`, the `POST …/answers` route description, the shared `Answer` schema
comment and the MCP `ask` tool description.
