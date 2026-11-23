---
title: cover custom styles and crawl settings in the user guide
date: 2026-11-23
pr: "#123"
status: in review
areas: [docs]
---

# Cover custom styles and crawl settings in the user guide

## Summary

The user guide catches up with features that merged after it: custom response styles (#109), the MCP
`style` argument (#111) and page links in citations (#120). `docs/guide/playground.md` adds custom styles,
the MCP tools and web-page sources, and `docs/guide/configuration.md` lists `CRAWL_ALLOWED_HOSTS`. Also marks
the README spec merged. No code changed.

The website import section in `docs/guide/adding-material.md` and the style picker lines came with their
own PRs (#121, #112) while this one was open, so this PR keeps theirs and drops its own draft of the same.

## Why

The user guide (2026-11-23-user-guide.md) left stubs for features still in review; the owner asked for the
guide to follow each one as it merges. Custom styles are created through the API until the admin styles
page (#114) lands.

## Design

- `playground.md`: sources can be a page address; admins' custom styles through `/v1/styles`; the MCP
  `list_styles` tool and `style` argument.
- `configuration.md`: a "Documentation websites" table with `CRAWL_ALLOWED_HOSTS`, the only crawl setting
  `docker-compose.yml` passes through from `.env`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Document custom styles through the API now | Wait for the styles page (#114) | They work today; #114 adds the UI steps |
| Leave `CRAWL_DELAY_MS` and `CRAWL_FETCH_TIMEOUT_MS` out of the configuration page | List them | Compose doesn't pass them to the API, so setting them in `.env` has no effect |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None (documented, not changed).
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

Docs only. Routes and fields checked against `docs/api-schema.md`, `docs/specs/2026-11-23-docs-website-import.md`
and `apps/api/src/routes/styles.ts`; links checked by script; `pnpm format:check` passes.

## Out of scope and follow-ups

When #114 merges, the guide gets the admin styles page. Screenshots of the style picker and the website
page can be added with the next screenshot pass.

## Docs updated

`docs/guide/playground.md`, `docs/guide/configuration.md`.
