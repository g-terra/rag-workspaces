---
title: One spec per pull request, with a template, a skill and mandatory Superpowers
date: 2026-11-22
pr: '#29'
status: merged
areas: [docs]
---

# One spec per pull request, with a template, a skill and mandatory Superpowers

## Summary

Every PR now adds a change spec in `docs/specs/YYYY-MM-DD-<topic>.md`, written from one template, so the
repo keeps a readable history of what changed and why. Agents get a `write-spec` skill and a rule in
`AGENTS.md`, and the repo enables the Superpowers plugin, whose design document becomes the spec. The
specs for the PRs already merged (#4, #5, #6) are written after the fact.

## Why

PR descriptions were the only record of each change, and they live outside the repo. Agents arriving
later could not tell how the code got where it is. The owner asked for a spec per PR, the same structure
for all of them, and a skill so agents write them (2026-11-22).

## Design

- `docs/specs/TEMPLATE.md`: front matter (`title`, `date`, `pr`, `status`, `areas`) and nine fixed
  sections. Every heading stays; "None." marks a section that does not apply.
- `docs/specs/README.md`: how specs differ from the long-lived docs, how to write and read them.
- `.claude/skills/write-spec/SKILL.md`: when and how an agent writes the spec. Other tools follow the
  same file as instructions.
- `AGENTS.md`: rule 7 ("Every PR adds a spec"), rule 8 ("Work through Superpowers": brainstorming →
  writing-plans → TDD → code review → verification; stop and ask if the plugin isn't loaded),
  `docs/specs/` in the reading list, and a Superpowers section with install steps and where its
  documents go.
- `.claude/agents/`: the architect names the spec file per planned PR, the coder writes it, the reviewer
  checks it against the template and the diff.
- `.claude/settings.json`: `enabledPlugins` turns on `superpowers@claude-plugins-official`, so Claude
  Code offers to install it for anyone who trusts the folder.
- Backfilled specs: `2026-11-20-monorepo-foundation.md` (#4), `2026-11-20-api-skeleton.md` (#5),
  `2026-11-20-compose-stack.md` (#6).

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| File name `YYYY-MM-DD-<topic>.md` | PR number prefix; sequence number | Known before the PR exists, sorts by date, matches Superpowers' naming; `pr:` holds the number |
| No index file | A table in `docs/specs/README.md` | Parallel PRs would all edit the same lines and conflict; `ls` already lists them |
| Merged specs are frozen except `status` | Keep specs updated like docs | They are history; `docs/architecture.md` and friends describe the present |
| Superpowers' brainstorming design doc is the spec, saved in `docs/specs/` | Keep `docs/superpowers/specs/` beside our specs | One document per change, one place |
| Superpowers plans stay out of the repo | Commit `docs/superpowers/plans/` | Step-by-step plans go stale the moment code lands; the spec keeps what lasts |
| Enable the plugin in project settings | Ask each person to install it | Everyone working in the repo gets the same workflow |
| Superpowers is mandatory (rule 8); agents stop if it isn't loaded | Recommended only | Owner's call (2026-11-22): every change goes through the same design, test and review steps |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: `.claude/settings.json` enables `superpowers@claude-plugins-official`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None. Process contract: a PR without a spec fails review (`reviewer` check 10).

## Operations

Nothing to migrate. People using Claude Code accept the plugin install prompt once. Other tools ignore
`.claude/settings.json` and follow `AGENTS.md`.

## Testing

Documentation only. `pnpm format:check` passes (Prettier skips Markdown). Check by hand: open Claude
Code in the repo, accept Superpowers, ask for a small change and see the spec land in `docs/specs/`.

## Out of scope and follow-ups

- Specs for the open PRs #7 to #23 are added on their own branches, one per PR.
- A PR on top of the stack brings `docs/architecture.md`, `docs/api-schema.md` and `docs/decisions.md`
  up to date with everything the stack changed.
- A CI check that each PR adds a spec could come later if reviews miss it.

## Docs updated

`AGENTS.md` (rule 7, reading list, Superpowers), `.claude/agents/*.md`, new `docs/specs/README.md`.
