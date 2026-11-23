---
title: make the tuned settings the workspace defaults
date: 2026-11-23
pr: "#93"
status: merged
areas: [api, docs]
---

# Make the tuned settings the workspace defaults

## Summary

Workspaces that don't set their own values now use the settings tuned on the OUC material
([docs/tuning.md](../tuning.md)): chunks of 1200 characters with 200 overlap (was 800/100), 8 passages per answer (was 5),
and the tuned system prompt. The minimum score stays 0.3.

## Why

Guilherme asked for the tuning findings to be the defaults for new workspaces. On `ouc`, the tuned settings moved the
15-question set from 10 correct, 1 partial and 4 wrong to 12 correct, 2 partial and 1 wrong.

## Design

- `apps/api/src/config.ts`: `DEFAULT_CHUNK_SIZE` 1200, `DEFAULT_CHUNK_OVERLAP` 200, `DEFAULT_TOP_K` 8. Each can still be
  set in `.env`, and each workspace can override them.
- `apps/api/src/services/generate.ts`: `DEFAULT_SYSTEM_PROMPT` is the tuned prompt with two general edits: "course
  material" becomes "this workspace's material", and the transcripts rule says "Prefer the other documents" instead of
  "slides or books".

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Change the code defaults | Write the values into `.env.example` only | Every install gets them, also one without the wizard |
| General wording in the prompt | The OUC prompt word for word | The default serves any workspace; the general variant is untested, which the tuning guide notes |
| Keep the vague-question rule | Drop it | Harmless, and asks for the right behaviour even though models follow it unreliably |
| Leave the chat model and reasoning effort | Change them here | The default chat model is Guilherme's choice; "none" is not safe for every provider |

## Interfaces and contracts

- **HTTP API**: `GET /v1/system` reports the new defaults. No route or shape changes.
- **Configuration**: defaults of `DEFAULT_CHUNK_SIZE` (1200), `DEFAULT_CHUNK_OVERLAP` (200) and `DEFAULT_TOP_K` (8).
- **Data**: None. Defaults aren't stored per workspace.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Defaults apply to every workspace that doesn't set its own value, including existing ones: top-k and the prompt from the
next answer, chunk size from the next upload or reindex. To keep the old values for a workspace, set them in its
settings; to keep them everywhere, set the variables in `.env`.

## Testing

- `apps/api/src/config.test.ts`: the defaults are 1200/200/8 with minimum score 0.3, and the default prompt carries each
  tuned rule. Both failed before the change.
- `answers.test.ts` checks the answer flow gets the default prompt; `ingest.test.ts` now expects the 200 overlap default.

## Out of scope and follow-ups

- The default chat model and reasoning effort (a decision card is with Guilherme).

## Docs updated

`docs/tuning.md` (which values are now defaults) and `docs/api-schema.md` (example defaults).
