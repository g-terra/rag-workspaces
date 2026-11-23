---
title: render answers as markdown in the admin UI
date: 2026-11-23
pr: pending
status: in review
areas: [admin]
---

# Render answers as markdown in the admin UI

## Summary

Answers in the playground's Ask and Chat modes, and replies on the Conversations page, are now rendered
as markdown (bold, italics, lists, tables, code, links) instead of showing the model's raw `**` and `-`.
The `[n]` citation chips keep working inside the rendered text, including inside bold or a list item.
Raw HTML in an answer is shown as text and never rendered.

## Why

Guilherme, 2026-11-23, with a screenshot of a Chat answer showing `**declarative stage**`: "markdown is
not being rendered in the chat". Models served by LM Studio (and the hosted ones) write markdown by
default, so every real answer looked broken. Builds on the playground specs
`2026-11-23-admin-playground-ask.md`, `-chat.md` and `2026-11-23-admin-conversations.md`.

## Design

- `apps/admin/src/playground/answer-markdown.tsx`: `AnswerMarkdown` renders the text with
  `react-markdown` and `remark-gfm`, plus two small remark plugins written here:
  - `remarkCitations` walks the markdown tree and splits each **text** node with the existing
    `answerParts` (`answer.ts`), replacing each accepted `[n]` with a `cite-marker` element that the
    caller renders (`renderCitation`). Inline code and code blocks are separate node types, so a
    subscript like `items[1]` in code is never turned into a chip, on top of the "attached on the left"
    rule `answerParts` already has.
  - `remarkCaret` puts the streaming caret at the end of the last paragraph, or on its own line when
    the answer ends in a list or table.
  - `a` opens in a new tab with `rel="noreferrer"`; `img` is replaced by its alt text, so an answer
    can't make the browser load a URL the model chose.
- `apps/admin/src/playground/answer-view.tsx`: `AnswerText` now wraps `AnswerMarkdown` in a
  `div.answer-md` and renders `CitationMarker` for each chip. Ask (`ask-panel.tsx`) and Chat
  (`chat-view.tsx`) swap their `<p whitespace-pre-wrap>` wrapper for a `div`, since a paragraph can't
  hold lists or tables.
- `apps/admin/src/routes/conversations.tsx`: stored replies use `AnswerText` too, so they get markdown
  and clickable chips (before, they were plain text with literal `[1]`).
- `apps/admin/src/index.css`: an `.answer-md` block with spacing, list markers, code, blockquote and
  table styles (Tailwind's preflight removes them; the typography plugin would be a bigger dependency
  for the same few rules).
- `poc/standin/server.ts`: the stand-in model's answer now starts with a bold
  `**Based on the provided context:**`, so the e2e test sees markdown rendered end to end.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| `react-markdown` 10 + `remark-gfm` 4 | `marked` + DOMPurify into `dangerouslySetInnerHTML`; a hand-written renderer | React elements, no HTML string and no sanitizer to keep right; citation chips stay real React buttons with their click handlers. A hand-written renderer would miss nested lists, tables and code fences |
| No `rehype-raw`, so raw HTML is text | Allow a sanitized subset of HTML | Answers come from a model reading uploaded documents; any HTML in them is a prompt-injection risk with no upside |
| Citations split in the markdown tree | Pre-split the string and render markdown per piece | Splitting the string breaks formatting that spans a marker (`**generates [2]**`); in the tree, a chip sits inside the bold |
| Images shown as alt text | Render them | An image URL loads from wherever the model pointed it (tracking, internal hosts) |
| Admin bundle grows about 50 KB gzipped (227 to 277 KB) | Lazy-load the renderer | Answers are the main thing the playground shows; splitting would only delay the first answer |
| Partial markdown while streaming (`**bol`) shows as typed until closed | Hide trailing unclosed markers | Simple and honest; it settles as soon as the closing marker arrives |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None. The stand-in model's answer text changed (a bold lead-in); nothing in the
  smoke checks matches on it.

## Operations

None. New dependencies: `react-markdown`, `remark-gfm` (runtime) and `@types/mdast` (types for the two
plugins), all in `apps/admin`.

## Testing

- `apps/admin/src/playground/answer-markdown.test.tsx` renders with `react-dom/server`: bold, lists
  and tables render; chips appear in plain text and inside bold; a rank without a citation and a
  marker in inline code or a code block stay text; raw `<img onerror>` and `<script>` never become
  markup; `javascript:` links are dropped and real links open in a new tab; the caret sits at the end
  of the last paragraph only while streaming.
- `apps/admin/e2e/playground.spec.ts` (Ask): the answer has a `<strong>` with the stand-in's lead-in
  and no `**` left.
- By hand: `pnpm --filter @rag/admin dev` against a stack with LM Studio, ask something that invites a
  list ("What are the stages of skill acquisition? Answer as a list."), check bold, bullets and that
  the `[1]` chips still open their passage, in Ask, in Chat and on the Conversations page.

## Out of scope and follow-ups

- Math (KaTeX) and syntax highlighting in code blocks: not asked for.
- The other playground fixes from the same request (mode explanations, hiding conversation ids,
  default values in settings, PDF preview) are separate PRs with their own specs.

## Docs updated

None needed: no long-lived doc describes how the admin UI renders answer text.
