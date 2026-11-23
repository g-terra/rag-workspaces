---
title: Smoke-test the website import on the compose stack
date: 2026-11-23
pr: pending
status: proposed
areas: [smoke, poc, docs]
---

# Smoke-test the website import on the compose stack

## Summary

The compose smoke test imports a stub documentation website served by the stand-in model server, and
checks the whole path: crawl, robots.txt, main-content extraction, ingestion, a search hit that cites the
page's URL, a second crawl that changes nothing, the SSRF refusal of an internal service, and removal.

## Why

The crawler's unit tests use a fake fetcher, and the component was checked by hand against a Langflow
container. Nothing ran the API, Langflow, Chroma and the ingest queue together on a crawl, so a broken
wire between them (tweak names, the flow's output, `CRAWL_ALLOWED_HOSTS`) would only show on someone's
machine.

## Design

- `poc/standin/server.ts` serves `/robots.txt` (disallows `/site/docs/private`, names the sitemap),
  `/site/docs/sitemap.xml` (three pages) and four HTML pages, each with a `<nav>` and a `<footer>` around
  its `<main>`.
- `docker-compose.smoke.yml` sets `CRAWL_ALLOWED_HOSTS: standin` on Langflow. `standin` is also in
  `LANGFLOW_SSRF_ALLOWED_HOSTS` (it is the model server), so this exercises the rule that a host Langflow
  trusts for itself needs its own entry to be crawled.
- `scripts/smoke/check.ts` adds one step before the workspace is deleted. It imports
  `http://standin:1234/site/docs/` with `maxPages: 10` and waits for the crawl. Then it checks:
  - 3 new pages, and none for the disallowed page;
  - the pages are ingested, and the usage page's passages hold its text without the nav or footer;
  - a search for that text returns the page first, with its `sourceUrl`;
  - crawling again leaves 3 unchanged, 0 new and 0 removed;
  - `http://chroma:8000/docs/` fails with the SSRF guard's reason;
  - removing the site leaves no pages and no passages in Chroma.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| Serve the stub site from the stand-in | A separate static server container | The stand-in already runs in the smoke stack, has no dependencies, and is reachable by name from Langflow |
| Crawl at the default 1 s delay | Lower `CRAWL_DELAY_MS` for the smoke stack | Three pages take a few seconds; the default is what people run |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: `CRAWL_ALLOWED_HOSTS: standin` in the smoke overlay only.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None. `pnpm smoke` runs about ten seconds longer.

## Testing

This is the test: `pnpm smoke`, and the smoke workflow on this pull request. It could not run in the
sandbox the change was written in (image builds there cannot reach npm), so CI is its first run. The stub
pages were checked against a Langflow 1.13.3 container through `rw-fetch`: the page was cleaned, the
sitemap was `complete`, the private page was `blocked`, and an internal host was refused.

## Out of scope and follow-ups

A Playwright test of the Add website dialog on the same stack.

## Docs updated

None: the smoke test's steps are listed in its output, and `docker-compose.smoke.yml` explains the new line.
