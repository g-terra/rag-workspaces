---
title: add a user guide with screenshots
date: 2026-11-23
pr: "#113"
status: in review
areas: [docs]
---

# Add a user guide with screenshots

## Summary

Adds `docs/guide/`, a user guide for people running and using rag-workspaces: workspaces and their
settings, adding material, the playground and conversations, API keys and MCP agents, models and
providers, usage analytics, and a reference of every `.env` setting. Screenshots of the admin UI go in
`docs/images/`. Features not on `main` yet (response styles, website import) get a short "Coming soon" note
where they will fit. No code changed.

## Why

The owner asked for "a wiki explaining usages and configs" with screenshots (2026-11-23). What a person
needs to use the system was spread across the README (a long paragraph walking through the admin UI),
`docs/setup.md` (install and models), `docs/api.md` (scripts) and `.env.example` (settings, as comments).
Nothing explained the workspace settings, roles or usage charts in one place. Builds on the contributing
guide (2026-11-23-contributing-guide.md); the README rewrite that links here comes next.

## Design

- `docs/guide/README.md` is the index, with a table of who (reader, editor, admin) can do what.
- One page per task: `workspaces.md`, `adding-material.md`, `playground.md`, `api-keys.md`,
  `providers.md`, `usage.md`, `configuration.md`. Tuning stays in `docs/tuning.md` and is linked.
- Each page describes what the admin UI shows, with a screenshot, then the matching API call, and links
  `docs/api.md` for detail rather than repeating it.
- `configuration.md` lists every variable in `.env.example` plus `CHAT_HISTORY_TURNS` (passed by
  `docker-compose.yml`), grouped, with defaults from `apps/api/src/config.ts` and the compose file.
- Screenshots in `docs/images/` were taken with Playwright from the throwaway smoke stack
  (`pnpm smoke --keep`), which has a stand-in model and seeded sample material: no personal data, no real
  model. Answers in the playground shots are the stand-in's canned replies.
- In-flight features get a quoted "Coming soon" note with a link to their PR, so the page they belong on
  already exists when they merge.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A guide in `docs/guide/`, in the repo | The GitHub Wiki (enabled on the repo) | The Wiki is a separate Git repo outside PRs, review and CI, so it drifts from the code; AGENTS.md rule 6 keeps docs true in the PR that changes behaviour. The guide can be mirrored to the Wiki later |
| Plain Markdown that GitHub renders | A docs site (Docusaurus, MkDocs) | A site adds a build, dependencies and hosting for eight pages; rule 1 says add nothing before it's needed |
| Screenshots from the smoke stack | The owner's live stack | No personal material or credentials in a public repo, and anyone can retake them with the same command |
| "Coming soon" notes for open PRs | Wait for them to merge, or leave them out | The owner asked to cover them; a short note keeps the structure and each feature's PR fills it in |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None (documented, not changed).
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

Docs only. Every route, field, label, default and limit was checked against the code on `main`:
`apps/api/src/config.ts`, `docker-compose.yml`, `.env.example`, `packages/db/src/schema.ts` and the admin
UI's routes (`apps/admin/src/routes/*.tsx`, `playground/search.ts`, `workspaces/wizard.ts`). Links between
pages were checked by hand. `pnpm format:check` passes.

## Out of scope and follow-ups

- The README rewrite that links the guide is the next PR.
- Screenshots from a real model on the owner's `ouc` workspace can replace the playground shots later.
- When response styles (#105) merge, its PR (or a follow-up) replaces the "Coming soon" note. Website
  import has no PR yet. The Keycloak sign-in theme (#104) and the first-time walkthrough (#107) will need a
  line each when they land.
- Mirroring the guide to the GitHub Wiki, if the owner wants it.

## Docs updated

`docs/guide/` (new, eight pages), `docs/images/` (new screenshots).
