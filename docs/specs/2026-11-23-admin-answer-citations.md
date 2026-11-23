---
title: Citations and passage previews in the admin playground
date: 2026-11-23
pr: pending
status: proposed
areas: [admin]
---

# Citations and passage previews in the admin playground

## Summary

An answer in the playground now shows where it came from. The `[n]` markers the model writes become
buttons in the text, and a "Sources" list beside the answer gives each passage the model was given with
its rank, document, page and similarity score. Opening either shows the passage in full with the
passages just before and after it (`GET /v1/workspaces/{slug}/passages/{passageId}`) and a link to its
document, which the document library now opens selected through `?doc=<id>`. Follows
`2026-11-23-admin-playground-ask.md`.

## Why

Milestone M4, and the owner's ask: an answer people cannot trace is not much use. The route and its
`{ passage, previous, next }` shape are specified in `2026-11-20-passages.md`; the citation shape
(`rank`, `passageId`, `documentTitle`, `page`, `snippet`, `score`) in `2026-11-20-answers.md`, where
`rank` is documented as the `[n]` the text may cite. Layout and copy follow the approved "Playground"
mock's answer card and its Sources column.

## Design

1. **Markers in the text** (`src/playground/answer.ts`). `answerParts(text, ranks)` splits the answer
   into text and markers. A marker is only taken as one when every rank it names has a citation, so a
   model that writes `[9]` for a passage it was not given leaves that text alone rather than offering a
   button that opens nothing. `[1, 2]` becomes two markers, because models write citation lists that
   way. The page renders each marker as a `<button aria-label="Source n">`, which opens that citation's
   passage.
2. **The Sources list** (`src/routes/playground.tsx`). Beside the answer, one button per citation: the
   rank, the document title, the score to two decimals, the page when the document has pages, and the
   API's snippet. It says how many passages the model was given, rather than how many it cited, because
   that is what the citations are.
3. **The passage preview** (`src/playground/passage-dialog.tsx`, `src/playground/queries.ts`).
   `usePassage()` is idle until a citation is opened, then reads the passage with its neighbours; the
   dialog shows the passage highlighted between them, its id, and a link to its document.
   `passageWhere()` writes the subtitle: "Week 3 slides · page 12", or the passage's position when the
   document has no pages (a text or Markdown file).
4. **The document link** (`src/routes/documents.tsx`). The library already selects a row in page state;
   it now starts from `?doc=<id>` when the URL names one, so the link from a passage opens the document
   with its detail panel open. Nothing else about the library changes.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Only render a marker whose rank has a citation | Render every `[n]` as a button | A button that opens nothing is worse than the text the model wrote |
| Accept `[1, 2]` as two markers | Only accept `[n]` | Models write citation lists that way, and the alternative shows raw brackets |
| Sources count "given to the model" | "3 cited of 5 retrieved", as the mock says | The API sends the passages the model was given; which of them the text cites is a property of the prose, not data |
| `?doc=<id>` read once into page state | Keep the selection in the URL as it changes | The library's selection is not a place you navigate to; one-way deep linking is all the link needs |
| A dialog for the passage | A third column, or a page per passage | It is a quick look at the words behind a claim, and the mock keeps the answer in view |
| `usePassage` idle until opened | Prefetch every citation with the answer | Most citations are never opened; each is a Chroma read |

## Interfaces and contracts

- **HTTP API**: None changed. The UI calls `GET /api/v1/workspaces/{slug}/passages/{passageId}`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None. The streamed `citations` event stays ignored: the `done` record that
  follows it carries the same citations.

## Operations

Existing installs: `docker compose up -d --build web`. `/w/<slug>/documents?doc=<id>` is a new link
shape; an unknown or deleted id simply leaves no row selected.

## Testing

- `apps/admin/src/playground/answer.test.ts`: `answerParts()` with no markers, a marker between words,
  a comma list, a two-digit rank, a rank with no citation (left as text, alone and inside a list),
  markers back to back, and an empty answer; `passageWhere()` with and without a page.
- `apps/admin/e2e/playground.spec.ts` (real stack): after the streamed answer, the Sources list holds the
  ingested document, opening it shows the passage text and its id, and "Open the document" lands on the
  library with that document selected.

The stand-in model writes no `[n]` markers (it quotes the best-matching sentence instead), so the
markers themselves are covered by the unit tests rather than the e2e; the Sources list and the passage
preview are what the e2e drives. By hand against a real model, ask a question whose answer cites two
passages and check that each marker opens the right one.

## Out of scope and follow-ups

Thumbs up/down feedback is the next PR in this stack. Left out of the mock: "3 cited of 5 retrieved"
(see the decisions above), highlighting the Sources entry belonging to the marker you pressed (the
dialog already names the passage), and the timestamp links for audio passages (`startSeconds` is
planned, not in the API).

## Docs updated

None needed: `README.md` describes the playground, and citations change nothing it states.
