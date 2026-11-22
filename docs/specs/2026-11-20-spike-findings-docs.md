---
title: Langflow spike findings in the plan; flow contract in flows/README.md
date: 2026-11-20
pr: '#10'
status: merged
areas: [docs, flows]
---

# Langflow spike findings in the plan; flow contract in flows/README.md

## Summary

Writes what the Langflow spike (`poc/RESULTS.md`) proved into the long-lived docs. Adds
`flows/README.md`, the contract between the API and the Langflow flows, records decision 20 (keep
ChromaDB through small custom Langflow components), and updates the architecture's provider and flow
sections. Docs only.

## Why

M0's "done when" includes "the spike's findings are written into the docs". The POC PR (#3) listed the
changes but didn't make them.

## Design

- `flows/README.md`: seven rules (run by endpoint name; tweaks keyed by fixed node ids; `ChatInput-` and
  `ChatOutput-` id prefixes; structured output as fenced JSON; always send a session id; provider keys
  travel as tweaks; the API picks the collection), then one table per flow with node ids, tweak fields
  and output shape.
- `docs/architecture.md`: pinned image versions, flow contract section, provider switching settled by
  F7, repo layout with `langflow/components/` and `poc/`.
- `docs/decisions.md`: decision 20.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Decision 20: ChromaDB via custom components over Chroma's REST API | Switch vector store; pin an older Langflow with the Chroma component | Langflow 1.13 retired its Chroma component; a small httpx component keeps decision 4 and the pinned version |
| Provider keys sent by the API as tweaks on the `LLM` node | Langflow global variables from its environment | Langflow 1.13 refuses to send environment keys to non-OpenAI hosts (F3) |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: `flows/README.md` becomes the contract: node ids (`Loader`, `Split`, `Embeddings`,
  `Upsert`, `Search`, `Prompt`, `LLM`, `Delete`, `ChatOutput-*`) and their tweak fields are API-facing
  and must not be renamed without changing the API.
- **Events and logs**: None.

## Operations

None.

## Testing

Each table row was checked against the flow JSON and component code. A later CI check can assert every
node id listed exists in the committed JSON.

## Out of scope and follow-ups

Renaming endpoints to `rw-*` (#14) and the chat flow (#21) update `flows/README.md` again.

## Docs updated

New `flows/README.md`; `docs/architecture.md`; `docs/decisions.md` (decision 20).
