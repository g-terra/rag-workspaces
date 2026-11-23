---
title: Set how long the chat model reasons
date: 2026-11-23
pr: "#86"
status: in review
areas: [api, flows, langflow, docs]
---

# Set how long the chat model reasons

## Summary

Each workspace has a new setting, `reasoningEffort` (`none`, `minimal`, `low`, `medium`, `high` or `null`),
with a default in `.env` (`DEFAULT_REASONING_EFFORT`). When either is set, answers and chat replies send it
to the chat model as `reasoning_effort` on `/v1/chat/completions`, for LM Studio and OpenAI. `none` stops
a thinking model such as Qwen 3 from reasoning before it answers. With both unset, nothing is sent, as
before.

## Why

The answer-quality tuning on Guilherme's Mac (2026-11-23) found that Qwen 3.x thinks before every answer by
default. qwen3.8-27b spent up to 5,700 reasoning tokens and 21 to 358 seconds per answer. LM Studio honours
`reasoning_effort: "none"` on chat completions (tested at 0 reasoning tokens). With it, qwen3.6-35b-a3b
answered 27 questions in 1.1 to 4.2 seconds, against 1.3 to 8.7 seconds for gpt-oss-20b. The tuning asked
for a per-workspace setting with an `.env` default, where `null` sends nothing.

## Design

1. **Settings:** `ReasoningEffort` in `packages/shared/src/workspaces.ts`. `WorkspaceSettings.reasoningEffort`
   is nullable and editable with `PATCH` like the other optional settings. `GET /v1/system` reports the
   default in `defaults.workspace.reasoningEffort`.
2. **Config:** `DEFAULT_REASONING_EFFORT` (`apps/api/src/config.ts`), where empty means unset. It is passed
   through `docker-compose.yml` and documented in `.env.example`.
3. **Generation:** `Generator.generate` (`apps/api/src/services/generate.ts`) sets the `LLM` tweak
   `reasoning_effort` to the workspace's value, else the default, else `""`.
4. **Langflow:** `WorkspaceChatModel` (`langflow/components/rag_workspaces/chat_model.py`) has a new
   advanced input `reasoning_effort`. For `lmstudio` and `openai`, a non-empty value is passed to
   `ChatOpenAI(reasoning_effort=…)`. langchain-openai 1.4.1 sends it on chat completions and keeps
   `temperature` (checked in the Langflow image). Anthropic and Gemini never get it. The field is in the
   `LLM` node of `flows/answer.json` and `flows/chat.json`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A fixed list of values | Free text | The API refuses a typo (`400`) instead of the model server failing at answer time. The list covers OpenAI's values and `none`. |
| `null` sends nothing | Default to `none` | Non-thinking models and servers that don't know the parameter keep working unchanged. Turning thinking off is a choice in `.env` or per workspace. |
| OpenAI-compatible providers only | Map it to Anthropic's thinking budget or Gemini's thinking config | Those take different shapes. Today they don't think unless asked, and nothing needs it yet. |
| A workspace setting with an `.env` default | `.env` only | Workspaces can use different chat models, and only some of them think. |

## Interfaces and contracts

- **HTTP API**: workspace `settings.reasoningEffort` (`null` by default), settable with `PATCH`, where an
  unknown value gives `400`. `GET /v1/system` gains `defaults.workspace.reasoningEffort`.
- **Configuration**: `DEFAULT_REASONING_EFFORT`, optional, one of the five values.
- **Data**: `workspaces.settings` (jsonb) may hold `reasoningEffort`. No migration.
- **Langflow**: the `LLM` node in `rw-answer` and `rw-chat` gains `reasoning_effort`. Node ids are
  unchanged.
- **Events and logs**: None.

## Operations

Set `DEFAULT_REASONING_EFFORT=none` in `.env` for a thinking model, then restart the API
(`docker compose up -d api`) and Langflow to load the flows. No reindex.

## Testing

- `apps/api/src/routes/answers.test.ts`: nothing is sent by default, and a workspace's `none` reaches the
  `LLM` tweak.
- `apps/api/src/routes/workspaces.test.ts`: `PATCH` takes a value and `null`, and refuses an unknown one.
- `apps/api/src/routes/system.test.ts`: the default is reported.
- `apps/api/src/flows.test.ts`: every `LLM` node has the field.
- `scripts/smoke/check.ts`: with the workspace set to `none`, the stand-in model receives
  `reasoning_effort: "none"`. It failed before the Langflow change. The stand-in's `/_log` now records
  the parameter.

## Out of scope and follow-ups

- The admin UI's workspace settings page: the next PR.
- Anthropic and Gemini thinking controls.

## Docs updated

`docs/api-schema.md` (settings and defaults), `docs/setup.md` (LM Studio section), `flows/README.md`
(`LLM` tweaks), `.env.example`.
