---
title: Answer from a composite workspace's sources
date: 2026-11-23
pr: "#117"
status: in review
areas: [api, flows, langflow, docs]
---

# Answer from a composite workspace's sources

## Summary

Answers, chat messages and passage search now work on a composite workspace: the question is searched in
each source with that source's own embedding model, the ranked lists are fused, and a new flow,
`rw-generate`, answers from the fused passages with the composite's chat model, prompt and style. Every
citation and passage now says which workspace it comes from (`workspace`), and a cited passage can be
previewed through the composite.

## Why

Second PR of the composite stack; the design and its decisions are in
`2026-11-23-composite-workspaces.md` (decision 25). The first PR added composites without a way to ask
them; this one makes them useful.

## Design

1. `apps/api/src/services/composite-search.ts`, `searchSources()`: reads the composite's sources in order
   (`sourcesOf`), skips any that is `reindexing`, and for each runs `rw-retrieve` through the existing
   `retrieve()` with **the source's** provider keys (`withWorkspaceKeys(source)`), embedding model,
   prefixes and `minScore`, for up to the composite's `topK` (or the request's `limit`/`maxPassages`).
   Hits are resolved against the source's documents (`resolveHits`), in parallel across sources.
2. `fuseSources()`: reciprocal rank fusion, k = 60, over the sources' own ranks; a tie (the same rank in
   two sources) goes to the higher cosine score. The top `limit` are renumbered 1..n.
3. `apps/api/src/services/generate.ts`: for a composite, nothing found → the fixed "couldn't find
   anything" reply, no model call, as before. Otherwise it runs `rw-generate` (streaming or not) with
   `ChatInput` = the question, `Prompt.context` = `contextText()` (the Search component's layout,
   `[n] (<source name>: <title>, page p)`), `Prompt.history` = the chat's earlier turns or `(this is the
   first message)`, and the composite's `LLM` settings and provider keys. The citations are the fused
   passages themselves; groundedness is checked the same way (`citesAny`).
4. `flows/generate.json` (`rw-generate`): `ChatInput → Prompt.question`, `Prompt → LLM →
   ChatOutput-answer`. Derived from `rw-chat` with its `Embeddings`, `Search` and `ChatOutput-citations`
   nodes removed, so the prompt template and LLM node are the same.
5. `apps/api/src/routes/passages.ts`: `GET …/passages` on a composite returns `searchSources()` (a
   `minScore` in the query is 400: each source has its own). `GET …/passages/{id}` looks the document up
   in the composite's sources and reads the chunk from that source's collection; a document outside them
   is 404.
6. `workspace` on passages and citations: `resolveHits` now takes the workspace and sets its slug.
   Stored citations (`answers.citations`, `messages.citations`) keep it; older rows lack it and are read
   back with the answering workspace's slug (`toApiCitation`).

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Answers to a composite use the chat prompt template (with history `(this is the first message)`) | A second flow with the answer template | One flow, and the chat template reads naturally with no history. Standard workspaces keep `rw-answer`. |
| The API formats the context | Pass passages as JSON to a component that formats them | The layout is six lines and is tested; a new component would add Langflow code for a string join. |
| Sources searched in parallel | One after another | Latency is the slowest source, not the sum. LM Studio serialises embeddings anyway. |
| `minScore` refused on composite search | Apply it to every source | Thresholds are per embedding model (see the first spec). |
| `workspace` always present, also for standard workspaces | Only on composite results | One shape for clients; the admin UI can show the source without checking the kind. |

## Interfaces and contracts

- **HTTP API**: `Passage`, `ScoredPassage` and `Citation` gain `workspace` (slug). On a composite,
  `POST …/answers`, `POST …/conversations/{id}/messages` (both streaming too), `GET …/passages` and
  `GET …/passages/{id}` work; `GET …/passages?minScore=` is 400.
- **Configuration**: None.
- **Data**: stored citations gain an optional `workspace`. No migration.
- **Langflow**: new flow `rw-generate` (nodes `ChatInput`, `Prompt` with tweaks `context` and `history`,
  `LLM` with the same tweaks as `rw-answer`, output `ChatOutput-answer`). `/ready` now also requires it.
- **Events and logs**: None.

## Operations

Restart Langflow so it imports `flows/generate.json`, then the API (its readiness check names a missing
flow). Nothing else changes for existing workspaces.

## Testing

- `apps/api/src/services/composite-search.test.ts`: fusion takes turns by rank not score, ties by score,
  an empty source leaves its slots, dropped hits keep their source rank; context layout.
- `apps/api/src/routes/composite-answers.test.ts` (Postgres, Langflow stubbed): each source searched with
  its own model, `top_k` and `min_score`; `rw-generate` gets the fused context and the composite's model
  and prompt; citations carry the source; nothing found → no model call; a reindexing source skipped; a
  key bound to the composite can ask but gets 404 on a source; chat sends the history; passage search
  fuses; a preview of a source's passage works and one from another workspace is 404.
- `apps/api/src/flows.test.ts`: `rw-generate` has only the four nodes and its chat input feeds the prompt.
- `scripts/smoke/check.ts`, new step: two real workspaces, a composite of both, an answer citing both,
  and a preview of a cited passage through the composite.

## Out of scope and follow-ups

- Admin UI for composites: next PR.
- Folder filters on a composite search (folders belong to sources).

## Docs updated

- `flows/README.md`: `rw-generate`.
- `docs/api-schema.md`: `workspace` on passages and citations, what works on a composite.
