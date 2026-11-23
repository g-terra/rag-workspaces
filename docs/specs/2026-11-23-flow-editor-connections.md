---
title: keep every flow connection when a flow opens in the Langflow editor
date: 2026-11-23
pr: "#42"
status: in review
areas: [flows, api, docs]
---

# Keep every flow connection when a flow opens in the Langflow editor

## Summary

Opening `rw-chat` or `rw-answer` in the Langflow editor showed "Some connections were removed because
they were invalid" and the prompt's `context` input lost its connection, so a flow saved from the editor
would answer without any retrieved passages. The cause is in `ChromaWorkspaceSearch`: its two outputs
were not marked `group_outputs`, so Langflow drew them as one dropdown handle and dropped every edge
from the output it did not select. This marks both outputs `group_outputs=True`, regenerates the flows,
and replaces the two legacy Text Input nodes in `rw-chat` with tweaks on the prompt's own fields.

## Why

`flows/*.json` is the contract between the API and Langflow (`flows/README.md`). A flow that loses a
connection when someone opens it is a trap: the editor autosaves, and the live flow then answers with an
empty context until Langflow restarts and reimports `flows/`. Guilherme hit this on his machine while
testing the merged stack, and also asked about the "Legacy" badges on the two Text Input nodes.

## Design

Langflow 1.13.3 decides how to draw a component's outputs in
`lfx/graph/flow_builder/component.py`: a component with several outputs, none of them
`group_outputs`, renders **one** handle with a dropdown. When such a flow opens, the canvas selects the
component's *first* output, clears the others, and `cleanEdges` removes every edge wired from them.

`ChromaWorkspaceSearch` (`langflow/components/rag_workspaces/chroma_search.py`) has two outputs that are
used at the same time: `context` into the `Prompt` node, and `passages` into `ChatOutput-citations`.
Because `passages` is first, the `context` edge was the one removed, in both `rw-answer` and `rw-chat`.
Both outputs now set `group_outputs=True`, which is what Langflow's own multi-output components (for
example `ConditionalRouter`) do, and each gets its own handle.

`rw-chat` also carried two `TextInput` nodes, `Question` and `History`, which Langflow 1.13.3 marks
legacy. The prompt's `question` and `history` are plain template fields, so the API can set them with a
tweak on the `Prompt` node and the two nodes and their edges are gone. `rw-chat` keeps its `ChatInput`:
the search query must hang off it, because Langflow only returns outputs downstream of the chat input.

The flows were regenerated with `poc/client/build-flows.ts` against Langflow 1.13.3 carrying the fixed
component, so the committed JSON matches the pinned version exactly. `flows/ingest.json` and
`flows/delete.json` are unchanged.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| `group_outputs=True` on both search outputs | Split the search into two components, one per output; or wire only `passages` and build the context in the prompt | One search per question is the point of the component: it caches the Chroma query and both outputs read that one result. Grouping is Langflow's own answer to this. |
| Question and history as `Prompt` tweaks | Replace the legacy `TextInput` nodes with `ChatInput` nodes | Langflow routes the run's top-level `input_value` to the chat input and only returns outputs downstream of it. Three chat inputs in one flow makes both behaviours ambiguous; prompt fields have neither problem and the flow loses two nodes. |
| Leave `WorkspaceChatModel`'s two outputs ungrouped | Group them too | Only `text_output` is wired and it is the component's first output, so nothing is dropped. Rule 1: add nothing before it is needed. |
| Check the rule in a test over the committed JSON | Trust review | The failure only appears in a browser, which no test here drives. Reading the JSON catches it in CI instead. |

## Interfaces and contracts

- **HTTP API**: None. Routes, requests and responses are unchanged.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: `rw-chat` no longer has the `Question` and `History` nodes. The latest message and the
  conversation so far are now tweaks on its `Prompt` node: `{ "Prompt": { "question": "…",
  "history": "…" } }`. Every other node id, tweak field and output is unchanged. `rw-answer`,
  `rw-retrieve` and `rw-chat` carry the regenerated `Search` node; `rw-ingest` and `rw-delete` are
  untouched.
- **Events and logs**: None.

## Operations

Langflow reimports `flows/` on every start, so `docker compose up -d` (or a restart of the `langflow`
service) picks the new flows up; no migration and nothing to undo. An install whose editor already
autosaved a flow with the dropped connection is repaired by the same restart, because the import
updates each flow in place by its fixed id.

## Testing

- `apps/api/src/flows.test.ts` (new) reads every committed flow and checks that no node wires more than
  one output from a single dropdown handle, that no node is a legacy component, and that every edge
  joins nodes the flow has. It fails on the flows as they were before this change (both `rw-answer` and
  `rw-chat` for the dropped edge, `rw-chat` for the legacy nodes) and passes after it.
- `apps/api/src/routes/conversations.test.ts` now expects the question and history as `Prompt` tweaks,
  which covers the API side of the contract change.
- By hand, against the stack: open http://localhost:7860, sign in and open `rw-chat` and `rw-answer`.
  No "Some connections were removed" banner appears, the prompt's `context` field says "Receiving
  input", and the Chroma Workspace Search node shows two handles, Passages and Context.
- End to end: `pnpm smoke` for ingestion and retrieval, plus a chat request against the smoke stack
  (create a workspace, upload a fixture, `POST /v1/workspaces/<slug>/conversations/<id>/messages`),
  which proves the prompt tweak reaches the model and the citations output still comes back.

## Out of scope and follow-ups

The smoke test still stops at retrieval; extending it to ask, chat and usage is the M2 item in
`docs/work-breakdown.md` (workstream 3, item 9) and gets its own PR.

## Docs updated

- `flows/README.md`: the `rw-chat` tweak table (Prompt instead of Question and History), and two new
  rules in the contract: group outputs that feed different nodes, and no legacy components.
