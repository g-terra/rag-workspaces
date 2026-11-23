---
title: cover website import and custom styles in the user guide
date: 2026-11-23
pr: pending
status: in review
areas: [docs]
---

# Cover website import and custom styles in the user guide

## Summary

The user guide catches up with features that merged after it: website import and page links in citations
(#119, #120), custom response styles (#109) and the MCP `style` argument (#111). `docs/guide/adding-material.md`
replaces its "Coming soon" note with an "Import a documentation website" section, `docs/guide/playground.md`
adds custom styles and web-page sources, and `docs/guide/configuration.md` lists `CRAWL_ALLOWED_HOSTS`.
Also marks the README spec merged. No code changed.

## Why

The user guide (2026-11-23-user-guide.md) left stubs for features still in review; the owner asked for the
guide to follow each one as it merges. The admin UI parts (style picker #112, styles page #114, website page
#121) are still open, so the guide describes the API and links those PRs.

## Design

- `adding-material.md`: what a crawl does, a `curl` example for `POST …/sites`, the other site routes, and
  the limits, pointing to `docs/setup.md#documentation-websites` for operations detail.
- `playground.md`: sources can be a page address; admins' custom styles through `/v1/styles`; the MCP
  `list_styles` tool and `style` argument; the picker's PR link.
- `configuration.md`: a "Documentation websites" table with `CRAWL_ALLOWED_HOSTS`, the only crawl setting
  `docker-compose.yml` passes through from `.env`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Document the API now, UI later | Wait for the admin UI PRs | The features work today through the API and MCP; each UI PR adds a line and a screenshot |
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

When #112, #114 and #121 merge, the guide gets the admin UI steps and screenshots for each.

## Docs updated

`docs/guide/adding-material.md`, `docs/guide/playground.md`, `docs/guide/configuration.md`.
