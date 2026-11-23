---
title: Start times on passages and citations
date: 2026-11-23
pr: "#72"
status: merged
areas: [api, flows, mcp, docs]
---

# Start times on passages and citations

## Summary

A passage that comes from a video or audio transcript now says the second it starts at. Search results,
passage reads, answer citations and chat citations all gain `startSeconds` (`null` for everything else,
the same way `page` is `null` for anything that isn't a PDF). The model's context labels such a passage
"at 12:34" instead of a page, and the MCP `ask` tool passes the field on.

## Why

Milestone M5 in `docs/work-breakdown.md` asks for "timestamped citations". The first part
([2026-11-23-video-transcription.md](2026-11-23-video-transcription.md)) already stores
`start_seconds` and `end_seconds` on every chunk of a transcript in Chroma. This PR carries the start
time from Chroma to the people and agents reading the answers.

## Design

1. **Search** (`langflow/components/rag_workspaces/chroma_search.py`): each hit gains
   `start_seconds` from the chunk's metadata. `get_context` labels a hit with no page but a start time
   `(<file>, at m:ss)`, or `h:mm:ss` past an hour (`clock()`), so the model can say when something was
   said. The component's code is embedded in `flows/retrieve.json`, `flows/answer.json` and
   `flows/chat.json`, and all three copies are updated (the drift test in `apps/api/src/flows.test.ts`
   checks that they match the file).
2. **API**:
   - `FlowPassage` (`apps/api/src/services/passages.ts`) gains an optional `start_seconds`.
     `resolveHits` maps it to `startSeconds`, keeping it only when it is a number.
   - `fromChunk` (`apps/api/src/routes/passages.ts`) does the same from the stored chunk's metadata, for
     `GET …/passages/{id}` and `GET …/documents/{id}/passages`.
   - `generate.ts` copies `startSeconds` onto each citation it stores.
   - `withStartSeconds()` in `generate.ts` fills in `null` for citations stored before this change.
     `toApiAnswer` and `toApiMessage` use it.
3. **Shared schemas** (`packages/shared`): `Passage` (and so `ScoredPassage`) and `Citation` gain
   `startSeconds: number | null`.
4. **MCP** (`apps/mcp/src/tools.ts`): the `ask` tool's citations include `startSeconds`.
   `search_passages` already returns whole passages, so it gets the field without a change.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Start time only, no end time, on passages and citations | Both `startSeconds` and `endSeconds` | A chunk can be shorter than the transcript row it came from, so the row's end is not the chunk's end. The start is the useful part: it is where to jump to. |
| Old stored citations read back as `null`, with no migration | A migration that rewrites the `citations` jsonb of every answer and message | The fields are snapshots, and a transcript citation stored before this change has no time to fill in anyway. Mapping on read costs nothing and touches no data. |
| `startSeconds` as a float | Whole seconds | Whisper gives fractions. Clients can round when they show it, and a player can seek to the exact point. |
| The context shows `at m:ss`, not raw seconds | `at 754.2 s` | Models repeat what they see, and people read times as clock times. |

## Interfaces and contracts

- **HTTP API**: `Passage`, `ScoredPassage` and `Citation` gain `startSeconds: number | null`. This
  covers `GET /v1/workspaces/{slug}/passages`, `GET …/passages/{passageId}`,
  `GET …/documents/{documentId}/passages`, answers (`POST`, `GET`, and the stream's `citations` and
  `done` events) and conversation messages. The field is added, not changed, so existing clients keep
  working.
- **Configuration**: None.
- **Data**: `StoredCitation` (`packages/db/src/schema.ts`) gains an optional `startSeconds`. There is no
  migration, because the column is jsonb.
- **Langflow**: the `Search` node's `passages` output gains `start_seconds` per hit (documented in
  `flows/README.md`). Node ids and tweaks are unchanged.
- **Events and logs**: None.

## Operations

Restarting the API re-imports the updated flows. Nothing else is needed: existing transcripts already
have `start_seconds` in Chroma.

## Testing

- `apps/api/src/routes/passages.test.ts`: a search hit with `start_seconds` returns `startSeconds`, a
  PDF hit returns `null`, and a passage's neighbours read it from chunk metadata.
- `apps/api/src/routes/answers.test.ts`: a citation from a transcript carries `startSeconds`, and an
  answer whose stored citations have no `startSeconds` reads back with `null`.
- `apps/api/src/routes/conversations.test.ts`: the same for a stored chat reply.
- `apps/mcp/src/tools.test.ts`: `ask` passes `startSeconds` on.
- `apps/api/src/flows.test.ts`: the three flows carry the new search code.
- `scripts/smoke/check.ts`: the WAV step now checks that search finds the transcript with a numeric
  `startSeconds`, through the real flows.
- By hand: upload a recording with the `video` profile on, then search for something said in it. The
  hit's `startSeconds` should be the moment it was said.

## Out of scope and follow-ups

- Showing the time in the admin UI (citations, search results, a transcript view): the next PR.
- An end time per chunk would need the loader to time each chunk on its own. It isn't needed for jumping
  to a moment.

## Docs updated

`docs/api-schema.md` (the citation example, and a note on `page` and `startSeconds`),
`docs/architecture.md` (status table), `docs/setup.md` (Video and audio section), `flows/README.md`
(chunk metadata and the `rw-retrieve` output).
