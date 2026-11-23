---
title: Composite workspaces that name several source workspaces
date: 2026-11-23
pr: "#116"
status: in review
areas: [api, db, admin, docs]
---

# Composite workspaces that name several source workspaces

## Summary

A workspace can now be **composite**: it holds no documents of its own and instead names two or more
ordinary workspaces as its **sources** (for example `study` = `ouc` + `personal`). It has its own slug,
routes, API keys, members, chat settings, style and usage. This PR adds the data model and the workspace
routes: creating a composite, changing its sources, and refusing the routes that only make sense for a
workspace with documents. Answering, chat and search across the sources are the next PR of the stack
(merged straight after this one, so main never offers composites that cannot answer), the admin UI the
one after; their parts below are the plan, and each of those PRs adds its own spec.

## Why

Guilherme asked (2026-11-23) for "a composite workspace made of multiple under the same API": one slug and
one API key that an agent can use to ask about his course material and his own notes together, without
copying documents between workspaces or holding a key per workspace. It builds on decision 2 (workspaces
are isolated groups of material), decision 9 (keys bound to workspaces) and decision 19/23 (per-workspace
models and provider keys). It is recorded as decision 25.

## Design

### Data (this PR)

- `workspaces.kind` (enum `workspace_kind`: `standard` | `composite`, default `standard`). Fixed at
  creation, like the slug.
- `composite_sources (composite_id, source_id, position)`: which workspaces a composite draws on, in the
  order the admin listed them. Both columns reference `workspaces` with `ON DELETE CASCADE`, so deleting a
  source silently drops it from every composite (the composite keeps working with what is left).
- A composite gets no Chroma collection and no upload folder. Its `settings` hold only what applies to it:
  chat provider and model, system prompt, reasoning effort, style, `topK`. Embedding and chunking settings
  belong to the sources, so for a composite `embeddingProvider` and `embeddingModel` are `null` in the API
  and `PATCH` refuses `chunkSize`, `chunkOverlap` and `minScore` (each source's own `minScore` applies,
  because it is calibrated to that source's embedding model).

### Routes (this PR)

- `POST /v1/workspaces` takes `kind: "composite"` and `sources: ["ouc", "personal"]` (slugs, two to ten,
  each an existing standard workspace, no repeats). Admin only, as before.
- `PATCH /v1/workspaces/{slug}` takes `sources` for a composite (the whole new list) and refuses it for a
  standard workspace.
- Every workspace in a response carries `kind` and `sources` (`null` for a standard workspace; for a
  composite, the slugs in order). A source the caller cannot see is still listed: the admin chose to
  expose it through the composite, and the slug alone reveals nothing else. This is the one exception
  to the isolation rule in `docs/api-schema.md`. Two to ten is checked when the list is written; deleting
  sources later can leave fewer.
- A composite answers `409` with a problem explaining that its documents live in its sources on:
  uploads and every other `documents` route, `folders`, `reindex`, and a document's passages. `GET` of the
  document list also answers 409 rather than an empty list, so a client does not think the composite is
  empty. A `preHandler` on the documents and folders plugins (`standardOnly`) gives that 409, only to a
  caller with access, so others still get 404.
- `setSources` locks the composite's row (`FOR UPDATE`) and the sources (`FOR SHARE`), so two edits at
  once take turns and a source deleted meanwhile is a 400, not a foreign-key error.

### Answering across sources (next PR, plan)

1. The question is searched in each source with **that source's** embedding model, prefixes, provider
   keys and `minScore`, through `rw-retrieve` as today. Each source returns up to the composite's `topK`.
   A source that is `reindexing` is skipped.
2. The lists are fused by reciprocal rank fusion (k = 60, as hybrid search does). Cosine scores from two
   different embedding models are not comparable, so ranks are what is fused; with sources that share no
   passages this takes turns between sources, best first, ties broken by score. The first `topK` are kept
   and renumbered `[1]…[n]`.
3. If nothing is left, the fixed "couldn't find anything" reply, no model call (as today).
4. Otherwise the passages go to a new flow, **`rw-generate`**: `ChatInput` (the question) → `Prompt`
   (`context`, `question`, `history` set as tweaks) → `LLM` → `ChatOutput-answer`. It has no search
   node: the API already holds the passages and their citations. The context follows the layout of the
   `Search` node's `context` output, with the source workspace's name and the document's title (not its
   file name) in each passage's heading.
   The composite's chat model, provider keys, system prompt, reasoning effort and style apply. Answers and
   chat messages both use it (an answer sends history `(this is the first message)`).
5. Answers, messages and usage rows are stored under the composite, so analytics, privacy (decision 21) and
   feedback work unchanged.
6. Each citation and searched passage gains `workspace`: the slug of the source it came from. The passage
   preview routes (`GET …/passages/{id}`) on a composite look the document up among its sources.

### Admin UI (last PR, plan)

A "Composite" choice in the create-workspace wizard with a pick-the-sources step instead of the embedding
and retrieval steps; a Sources section in settings; Upload, Library and Folders hidden for a composite;
the source workspace's name on each citation.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Access to a composite is enough to ask across its sources; it grants nothing else in them | Require the caller to also have access to every source | The point is one key and one slug. Only admins create composites and choose their sources, the same people who grant source access directly, so making a composite is a deliberate grant. It is read-only: no documents, folders or settings of a source can be reached through it, and passage reads are limited to documents in its sources. |
| Fuse by rank (RRF) across sources | Merge by cosine score; normalise scores per source | Sources may use different embedding models, whose cosine scales differ (nomic 0.5 is not OpenAI 0.5). RRF needs no calibration and is already how hybrid search fuses. |
| Each source searched with its own `minScore`, composite has none | One composite threshold | A threshold only means something for one embedding model. |
| New `rw-generate` flow without a search node | Teach `Search` to accept passages; one flow per source count | Search cannot run inside one flow for several embedding models. A flow that only prompts and generates keeps the model call in Langflow (decision 18 holds) and stays small. The fusion is bookkeeping over ranked lists the flows returned. |
| Sources are standard workspaces only, two to ten | Composites of composites; one source | No cycles to guard and no unbounded fan-out. One source is just an alias. |
| Deleting a source drops it from composites silently | Refuse the delete while a composite uses it | Deleting is an admin act already guarded by a confirmation; a composite with one or no sources answers "couldn't find anything" until the admin edits it. |
| A reindexing source is skipped | Fail the whole question with 503 | The other sources can still answer; a standard workspace's 503 stays as it is. |
| `kind` fixed at creation | Convert a workspace into a composite | A standard workspace has documents and a collection; converting would orphan them. |
| Word: "sources" | "members", "parts" | `members` already means the people with access (`/members`). |

Risk: with sources that hold very different amounts of relevant material, taking turns gives a weakly
related source as many slots as a strongly related one, down to its `minScore`. The composite's `topK`
and the sources' `minScore` are the knobs.

## Interfaces and contracts

- **HTTP API**: `Workspace` gains `kind` (`standard` | `composite`) and `sources` (`string[] | null`);
  `settings.embeddingProvider` and `settings.embeddingModel` are `null` for a composite. `CreateWorkspace`
  takes `kind` (default `standard`) and `sources` (required for a composite, refused otherwise).
  `UpdateWorkspace` takes `sources` (composite only). `409` from document, folder, reindex and document
  passage routes on a composite; 400 for unknown, composite or repeated
  sources. Next PR: `Citation.workspace` and `ScoredPassage.workspace` (source slug).
- **Configuration**: None.
- **Data**: migration `0011_composite_workspaces.sql`: enum `workspace_kind`, column `workspaces.kind`,
  table `composite_sources`.
- **Langflow**: None in this PR. Next PR: flow `rw-generate` (nodes `ChatInput`, `Prompt`, `LLM`,
  `ChatOutput-answer`).
- **Events and logs**: `workspace created` log line gains `kind`.

## Operations

The migration runs on API start and only adds; existing workspaces become `standard`. Undoing it means
deleting any composites first. Deleting a composite removes only its own rows (answers, conversations,
keys bound only to it are revoked as for any workspace); its sources are untouched.

## Testing

- `apps/api/src/routes/workspaces.test.ts` (describe "composite workspaces"): create a composite (sources
  in order, no Chroma collection), refusals on create and `PATCH` (one source, unknown source, a composite
  as a source, repeats, `sources` on a standard workspace, chunking or `minScore` on a composite), `PATCH`
  replaces the sources and bumps `updatedAt`, a reader sees the sources, deleting a source drops it,
  deleting a composite touches no collection.
- `apps/api/src/routes/composites.test.ts`: documents, folders and reindex answer 409 on a composite,
  404 for a caller without access, and the sources keep their own routes.
- `apps/api/src/routes/passages.test.ts` (last case): a document's passages through a composite: 409.
- By hand: `curl -X POST /v1/workspaces -d '{"slug":"study","name":"Study","kind":"composite","sources":["ouc","personal"]}'`
  then `GET /v1/workspaces/study`.

## Out of scope and follow-ups

- Answering, chat and search across sources, and `rw-generate`: next PR in this stack.
- Admin UI: last PR in this stack.
- Listing a composite's documents as the union of its sources' documents; composites of composites;
  per-source weights. Each can come if a real use needs it.

## Docs updated

- `docs/api-schema.md`: composite workspaces under Workspaces.
- `docs/decisions.md`: decision 25.
