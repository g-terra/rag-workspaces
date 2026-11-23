---
title: limit search, answers and chat to one folder
date: 2026-11-23
pr: "#50"
status: in review
areas: [api, docs]
---

# Limit search, answers and chat to one folder

## Summary

Three requests now take an optional `folderId`:

- passage search (`GET .../passages?folderId=`)
- answers (`POST .../answers`, in the body)
- chat messages (`POST .../conversations/{id}/messages`, in the body)

With it, only passages from that folder's documents are used. A folder that isn't in the workspace is
`404`, rather than an empty result that looks like "nothing relevant".

## Why

Folders exist so you can ask about one course or project without the rest of the workspace getting in the
way (docs/decisions.md, "Folders inside a workspace: optional, used as a filter"). Part 1
(docs/specs/2026-11-23-folders.md, PR #49) put the folder id on every passage in Chroma. This PR uses it.

## Design

1. **Schemas** (`packages/shared`):
   - `PassageSearch` gets `folderId?` (a query parameter).
   - `AskQuestion` and `SendMessage` get `folderId?` in the body.
2. **Routes** (`passages.ts`, `answers.ts`, `conversations.ts`) check the folder with `requireFolder`
   (`apps/api/src/services/folders.ts`, now shared with the document routes) before anything runs. They
   pass the folder id on through `AnswerService.ask`, `ConversationService.send` and
   `Generator.generate`.
3. **`searchTweaks`** (`apps/api/src/services/passages.ts`) sets the `Search` node's `folder` tweak. The
   chroma search component already turns that into `where: { folder }`. `rw-retrieve`, `rw-answer` and
   `rw-chat` share the node, so the grounding check and the generation both see only that folder.
4. **Chat**: the folder applies to one message, not to the conversation. A follow-up without `folderId`
   searches the whole workspace again.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Per message, not per conversation | Store a folder on the conversation | No column or migration, and the UI can keep sending the same id. A conversation-level default can come later if the UI wants one |
| `404` for an unknown folder | Search anyway and find nothing | A typo would look like "the material doesn't cover this" |
| No "top level only" filter | `folderId=none` as in the document list | Chroma can't filter on a missing metadata key, and nothing asks for it yet |
| Citations don't carry `folderId` | Add it to the stored citation snapshot | Old stored answers don't have it, and `documentId` already leads to the folder |

## Interfaces and contracts

- **HTTP API**:
  - `GET .../passages?folderId=fld_…`, `POST .../answers { …, folderId? }` and
    `POST .../conversations/{id}/messages { content, folderId? }`.
  - All three answer `404` for a folder that isn't in the workspace.
  - Response shapes are unchanged.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: the `Search` node's `folder` tweak is now set when a folder is given (`''` otherwise, as
  before). No flow JSON changed.
- **Events and logs**: None.

## Operations

None.

## Testing

- `apps/api/src/routes/passages.test.ts`, `answers.test.ts` and `conversations.test.ts`: one test each.
  `folderId` reaches the `Search` tweak (for answers and chat, on both the retrieve and the generate
  run), and a folder from elsewhere is `404` before any flow runs. All three fail with the tweak left at
  `''`.
- `scripts/smoke/check.ts`, through the real Langflow and Chroma: a search inside the folder returns only
  the moved document's passages, and a search inside an empty folder returns none.

## Out of scope and follow-ups

- A default folder per conversation, and a "top level only" filter.
- `folderId` on citations.

## Docs updated

- `docs/api-schema.md`: the passages route, the answers example and note, and the message body.
- `docs/architecture.md`: status table.
