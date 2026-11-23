---
title: Take the default model id on Enter in the setup wizard
date: 2026-11-23
pr: "#78"
status: merged
areas: [infra]
---

# Take the default model id on Enter in the setup wizard

## Summary

If `pnpm run setup` can't list a provider's models (LM Studio isn't running, for example), it asks for a
model id as text and shows the current or suggested id as the default. Pressing Enter to take that default
used to fail with "A model id is required.". Now it takes the default.

## Why

This was found while testing [2026-11-23-setup-whisper.md](2026-11-23-setup-whisper.md), and Guilherme
asked for it to be fixed.

## Design

`@clack/prompts`' `text` runs `validate` on the raw answer before it applies `defaultValue`, so an empty
answer never reached the default. The new `modelIdError(value, fallback)` in `scripts/setup/choices.ts`
lets an empty answer through whenever there is a default. Both model id prompts in `scripts/setup.ts` use
it.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Validate with the default in mind | Use `initialValue`, so the default is typed in already | With `initialValue`, a person has to delete the text to type another id. A default taken on Enter matches the hint the prompt shows. |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

- `scripts/setup/choices.test.ts`: `modelIdError` lets an empty answer through when there is a default,
  refuses it when there isn't one, and accepts any typed id.
- By hand: the wizard was driven in a terminal with LM Studio unreachable. Pressing Enter on both model
  prompts kept `qwen3-8b` and `Qwen3-Embedding-4B`.

## Out of scope and follow-ups

None.

## Docs updated

None needed: the wizard now does what `docs/setup.md` already describes.
