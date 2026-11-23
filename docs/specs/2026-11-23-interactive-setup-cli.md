---
title: Interactive setup CLI with arrow-key selection
date: 2026-11-23
pr: "#66"
status: merged
areas: [infra]
---

# Interactive setup CLI with arrow-key selection

## Summary

Upgrades `pnpm run setup` (`scripts/setup.ts`) from plain `node:readline` numbered prompts to an
interactive wizard powered by `@clack/prompts`: arrow-key `select` menus with descriptions for providers
and models (including hosted providers and a custom model-id fallback), masked `password` prompts for API
keys, spinners while querying providers and waiting for `/ready`, a confirmation step before starting
Docker Compose, a boxed summary of URLs at the end, and clean `Ctrl+C` cancellation. `--yes` and non-TTY
runs stay completely non-interactive with plain log output.

## Why

Requested by Guilherme on 2026-11-23 while testing `pnpm run setup` locally: typing numbers at raw
`readline` prompts felt bare, and model selection only listed models for LM Studio even though the wizard
already fetched model lists for OpenAI, Gemini and Anthropic. Builds on `2026-11-23-setup-wizard.md` (#53)
and `2026-11-23-setup-privileged-port-check.md` (#65).

## Design

1. **Option builders (`scripts/setup/choices.ts`, unit-tested).** Pure helpers that keep selection logic
   out of the terminal driver:
   - `providerOptions(kind)`: returns the arrow-key options (`value`, `label`, `hint`) for `lmstudio`,
     `openai`, `gemini`, and (for `chat` only) `anthropic`.
   - `modelOptions(kind, provider, models, current, suggested)`: splits LM Studio models by `chat` vs
     `embedding` via `splitModels`, keeps hosted provider model lists (highlighting embedding models when
     picking embeddings), prioritises the current or suggested model if present, and appends a
     `CUSTOM_MODEL` option (`Enter a custom model id…`) so a model not yet loaded can still be typed.
2. **Interactive driver (`scripts/setup.ts`).** Uses `@clack/prompts` (`intro`, `outro`, `note`, `log`,
   `spinner`, `select`, `text`, `password`, `confirm`, `isCancel`, `cancel`):
   - **Checks:** runs tool and port checks (`scripts/setup/ports.ts`) with `log.step` / `log.success` /
     `log.warn` / `log.error`.
   - **Models:** arrow-key `select` for chat provider, masked `password` for hosted keys (empty keeps an
     existing key; required if none is set), `spinner` while fetching models, scrollable arrow-key
     `select` (`maxItems: 10`) for the model (with `text` fallback when `CUSTOM_MODEL` is chosen or the
     provider is unreachable), then the same for embedding provider and model.
   - **Start:** shows a `note` summarizing the selected providers/models and any `.env` changes, asks
     `confirm` (`Start or update the Docker stack now?`, default `true`), runs `docker compose up
     --detach --build --wait`, spins while waiting for `GET /ready`, and finishes with a boxed `note`
     containing the Admin UI, API/Swagger, Langflow and Keycloak URLs plus `outro`.
   - **Cancellation & non-TTY:** any `Ctrl+C` (`isCancel`) calls `cancel('Setup cancelled.')` and exits
     `0`. Under `--yes` or `!process.stdin.isTTY`, no interactive prompt or spinner runs; defaults /
     existing `.env` values are kept and plain log lines are printed.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| `@clack/prompts` in root `devDependencies` | `@inquirer/prompts`; keep `node:readline` | Small, zero-bloat, TypeScript-native, works directly under Node 22 strip-types, and gives arrow-key `select`, masked `password`, `spinner`, `note`, and clean cancellation in one package |
| Offer `select` for hosted providers too (with `maxItems: 10` and `CUSTOM_MODEL`) | `text` input for hosted providers, `select` only for LM Studio | The wizard already queries the provider's model list; arrow-key selection avoids typos in long model ids while keeping custom entry one click away |
| Confirm before `docker compose up` in interactive mode | Always start immediately | Lets someone update `.env` / models or review what will happen before kicking off a multi-minute image pull/build; `--yes` skips the confirmation |
| Keep `choices.ts` pure and unit-tested under `node:test` | Test `@clack/prompts` interactively in CI | Pure option builders test every branch deterministically in milliseconds; interactive rendering is verified once in a PTY |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: Same `.env` keys (`DEFAULT_CHAT_PROVIDER`, `DEFAULT_CHAT_MODEL`,
  `DEFAULT_EMBEDDING_PROVIDER`, `DEFAULT_EMBEDDING_MODEL`, and optional provider API keys). No new
  variables.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: `pnpm run setup` output uses `@clack/prompts` formatting; `--yes` remains
  non-interactive.

## Operations

Run `pnpm install` after pulling to install `@clack/prompts` (in root `devDependencies`), then
`pnpm run setup`. Existing `.env` files are untouched except for settings the user changes.

## Testing

- `scripts/setup/choices.test.ts` (`pnpm test:scripts`):
  - `providerOptions('chat')` includes all four providers; `providerOptions('embedding')` excludes
    Anthropic.
  - `modelOptions` splits LM Studio chat vs embedding models, marks current/suggested defaults, sets the
    right `initialValue`, appends `CUSTOM_MODEL`, and returns `null` when no models are available (triggering
    the direct text prompt).
  - Hosted provider embedding selection prioritises embedding models when present while still allowing
    custom entry.
- By hand: run `pnpm run setup` in a terminal to verify arrow-key navigation, masked API key input,
  `Ctrl+C` cancellation, and `pnpm run setup --yes` non-interactive behaviour.

## Out of scope and follow-ups

- Changing ports interactively when a port check fails (keep the wizard focused; `.env` instructions
  remain).
- `pnpm doctor` reusing these helpers (M6 follow-up).

## Docs updated

None needed: `README.md` and `docs/setup.md` already describe `pnpm run setup` as the guided interactive
setup wizard.
