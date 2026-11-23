---
title: Browser test for importing a docs website
date: 2026-11-23
pr: pending
status: proposed
areas: [admin, e2e]
---

# Browser test for importing a docs website

## Summary

A Playwright test drives the admin UI's website import on the smoke stack, from the dialog through a
re-crawl to removal.

## Why

The website UI (#121) shipped with unit tests for its helpers only. The smoke test (#122) covers the API.
Nothing clicked through the dialog, the live list or the page links in a real browser.

## Design

`apps/admin/e2e/websites.spec.ts` uses the stub docs site the stand-in serves (#122). It:

- opens **Add website**, sees the "Leave out" validation, and imports `http://standin:1234/site/docs/`;
- waits for the site row to show Ready, 3 pages and 3 new;
- checks a page's globe and the panel's link to the page;
- clicks **Crawl again** and waits for 3 unchanged;
- removes the site and sees the section and its pages go.

It also marks the admin UI (#121) and smoke (#122) specs as merged.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Reuse the stand-in's stub site | Mock the sites API in the browser | The other e2e tests run against the real stack; a mock would not catch a wiring break |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. `pnpm e2e` runs about 20 seconds longer.

## Testing

This is the test: `pnpm e2e`, and the Admin UI Playwright workflow on this pull request.

## Out of scope and follow-ups

None.

## Docs updated

None.
