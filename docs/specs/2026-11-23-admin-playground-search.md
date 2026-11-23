---
title: Search mode in the admin playground
date: 2026-11-23
pr: "#58"
status: in review
areas: [admin]
---

# Search mode in the admin playground

## Summary

The playground gains mode tabs and its second mode: Search. It reads `GET
/v1/workspaces/{slug}/passages?query=&limit=` and lists the passages that best match, each with its
cosine similarity and its place in its document, with no model call at all — what an agent sees when it
builds its own prompt. A passage opens in the same preview the citations use. The mode is in the URL
(`?mode=search`), so a tab can be linked to and a reload keeps the mode you chose. Follows
`2026-11-23-admin-answer-citations.md`; Chat mode is the next PR in this stack.

## Why

Milestone M4, and the owner's ask. Searching without generating is how you tell a retrieval problem
apart from a model problem: if the passages are wrong, no prompt will save the answer. The route and its
`ScoredPassage` shape are specified in `2026-11-20-passages.md`. Layout and copy follow the approved
"Playground" mock's mode tabs and its "Passages only" panel, including the request line above the
results.

## Design

1. **Modes** (`src/playground/search.ts`, `src/routes/playground.tsx`). `parseMode()` reads `?mode=`
   and falls back to `ask`, so an unknown or missing value is never an error. The tabs are a
   `role="tablist"` group of buttons with `aria-selected`, which replace the mode in the URL rather
   than pushing a history entry. The route is now only the page's chrome: the panel for each mode lives
   in its own file (`ask-panel.tsx`, `search-panel.tsx`). Both panels stay mounted, with the one you are
   not on `hidden`, so reading the passages while an answer streams does not abort it and coming back
   shows the answer still there; `hidden` also takes a panel out of the accessibility tree, so nothing
   of it is reachable. They are keyed by workspace, so switching workspace starts both modes clean and
   never shows one workspace's answer under another's name.
2. **The shared box** (`src/playground/question-box.tsx`). Both modes type into the same card: a label,
   a growable textarea where `Ctrl`/`Cmd`+`Enter` submits, and a footer holding the mode's own controls
   and button. `Passages` is the count control, "5 passages" or "10 passages".
3. **The search** (`src/playground/queries.ts`, `search.ts`). `usePassageSearch()` is idle until a query
   is submitted, so typing costs nothing, and is keyed by query and limit, so going back to an earlier
   search is instant. The panel holds the query and limit that were actually submitted, so changing the
   count control does not quietly run another search, and the request line always names the search whose
   results are below it; submitting the same query and count again refetches, since the material may have
   changed since. `searchPath()` builds the path with `URLSearchParams`, which encodes a query holding
   `&` or `=`; the panel also shows that exact path above the results, as the mock does, which is why it
   is a function rather than inline string building.
4. **The results** (`src/playground/search-panel.tsx`). One row per hit: the score to two decimals
   (`formatScore()`, which the citation list now uses too), the passage's place as a button that opens
   the preview, and the first lines of its text. An empty result says nothing matched and names the
   relevance threshold as the reason, rather than showing an empty list. A failed search shows the
   API's reason with a retry.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| The mode lives in the URL | Component state | A tab you can link to and a reload that keeps it; the conversations screen will link straight to a mode |
| Replace, not push, on a tab change | Push a history entry per tab | Back should leave the playground, not walk through the tabs you tried |
| A panel file per mode | One large route file | The route file was already 300 lines with one mode; each panel owns its own state and reads on its own |
| Both panels mounted, the inactive one `hidden` | Render only the mode you are on | Peeking at the passages must not abort a streaming answer, and coming back should show it still there |
| `usePassageSearch` idle until submitted | Search as you type | Each search is an embedding call and a Chroma query; the mock has a Search button |
| The submitted query *and* count drive the results | Read the live count control | Changing the count would otherwise run a search nobody asked for, under the old request line |
| The same search again refetches | Do nothing when nothing changed | A Search button that sometimes does nothing reads as broken, and the material may have changed |
| Keyed by query and limit | One key, refetched | Going back to the previous search shows its results without asking again |
| Limits 5, 10, 20 | A number input | Three useful sizes, as the mock does; the API accepts 1 to 50 |
| The passage's place is the button | The whole row is one button | A button named by three lines of passage text is unusable with a screen reader |
| No `minScore` control | Offer the threshold per search | The threshold is a workspace setting; overriding it per search would hide what answers actually do |

## Interfaces and contracts

- **HTTP API**: None changed. The UI calls `GET /api/v1/workspaces/{slug}/passages?query=…&limit=…`.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Existing installs: `docker compose up -d --build web`. `/w/<slug>/playground?mode=search` is a new link
shape; any other value of `mode` opens Ask.

## Testing

- `apps/admin/src/playground/search.test.ts`: `searchPath()` encodes the query, and a slug and query
  carrying `&` and `=`; the limits offered are ones the API accepts; `formatScore()` at 0, 1 and a long
  decimal; `parseMode()` for each mode, for nothing and for nonsense.
- `apps/admin/e2e/playground.spec.ts` (real stack): switches to Search (and checks the URL), searches
  for a word in the fixture, sees one scored hit naming the document, opens the passage preview and
  closes it; searches for something nothing is close to and sees "Nothing matched"; reloads and finds
  Search still selected; switches back to Ask.

By hand: search a query with `&` in it to see it reach the API intact, and compare a search's top
passages with the sources of an answer to the same question — they should be the same passages.

## Out of scope and follow-ups

Chat mode, the third tab, is the next PR. Left out of the mock: the folder filter (the API has no
folders) and highlighting the matching words in a passage (the API returns no match offsets).

## Docs updated

`README.md` (the playground's two modes).
