---
title: add a contributing guide
date: 2026-11-23
pr: pending
status: in review
areas: [docs]
---

# Add a contributing guide

## Summary

Adds `CONTRIBUTING.md` at the repo root: dev machine setup, the five-step workflow every change follows
(design as a spec, plan, test first, review, verify), Conventional Commits with what each type does to the
version, how release-please cuts releases, the six CI checks plus the smoke and end-to-end suites, the PR
rules, and a map of the repo. The README's "Commits and releases" and "Development" sections move there,
and the README now points to it. No code changed.

## Why

The owner asked for a CONTRIBUTING.md (2026-11-23) as part of making the repo welcoming now that it is
public. The rules existed only in `AGENTS.md`, written for coding agents, and in two long README sections
written for the owner. GitHub links `CONTRIBUTING.md` from the new-issue and new-PR pages, so a person
finds it where they need it. This is the first of three docs PRs; the README rewrite and a usage guide in
`docs/guide/` follow.

## Design

- `CONTRIBUTING.md` restates the rules of `AGENTS.md` for people, in the order a contributor meets them:
  set up, make the change, commit, release, test, open the PR. It says that `AGENTS.md` wins where they
  differ, so there is one source of truth for the rules.
- The commit section adds a table of types and their release effect, taken from
  `release-please-config.json` and the existing README text, and lists the scopes the history actually
  uses.
- The test section describes what `scripts/smoke/check.ts` covers and when `.github/workflows/smoke.yml`
  and `e2e.yml` run, as those files say today.
- `README.md` loses "Commits and releases" and "Development" (about 60 lines) and gains a three-line
  "Contributing" section linking the new file. Nothing linked to the removed anchors.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Restate the rules for people, with `AGENTS.md` as the authority | Point `CONTRIBUTING.md` at `AGENTS.md` only | `AGENTS.md` is written to agents ("Claude Code: use the skill"); people need the why and the commands, and GitHub surfaces `CONTRIBUTING.md` |
| Describe Superpowers as five plain steps, naming the plugin | Require the plugin for everyone | Human contributors without Claude Code follow the same steps by hand, as `AGENTS.md` rule 8 already allows |
| Move the README's dev sections instead of copying them | Keep both | Two copies drift; the README is for people running the system |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

Docs only. Checked every command and path against the repo: the `package.json` scripts, the CI
workflows' triggers, `.husky/commit-msg`, `scripts/smoke/check.ts`, and the `apps/` and `packages/`
folders. `pnpm format:check` passes (Markdown is outside Prettier's scope here).

## Out of scope and follow-ups

The README rewrite (hero, screenshots, features, quick start) and the usage guide in `docs/guide/` are the
next two PRs. Issue and PR templates are not added: nothing asked for them yet.

## Docs updated

`README.md` (dev sections moved out, link added), `CONTRIBUTING.md` (new).
