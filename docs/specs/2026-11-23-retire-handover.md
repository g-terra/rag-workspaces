---
title: Retire the handover notes and mark merged specs as merged
date: 2026-11-23
pr: "#99"
status: in review
areas: [docs]
---

# Retire the handover notes and mark merged specs as merged

## Summary

Removes `docs/HANDOVER.md` and the "Handover" banner at the top of `AGENTS.md`, and sets `status: merged`
on the 55 specs whose PRs are merged but still said `in review`. The handover spec
(`2026-11-23-handover.md`) is marked superseded by this one, and `2026-11-22-setup-cli-plan.md` gets the
PR number it never had (#32). Nothing outside `docs/` and `AGENTS.md` changes.

## Why

A review of the codebase on 2026-11-23, after part of the build ran in Google Antigravity, found the
docs no longer told the truth about where the work stands:

- `AGENTS.md` opened by saying the work "moved from Claude Code to another agent" and sent every agent to
  `docs/HANDOVER.md` first. That file (from `2026-11-23-handover.md`, #63) lists the admin UI stacks and
  the video branch as in flight; all of them merged that afternoon (#54 to #64, #70 to #73). Its own
  intro says to delete it once its list is finished.
- `docs/specs/README.md` says a spec's `pr:` is set when the PR opens and `status` changes after merge.
  Specs were set to `in review` when their PRs opened, but no one changed them after the merges, so
  `ls docs/specs` read as if 56 PRs were still open.

## Design

1. Delete `docs/HANDOVER.md`. Its remaining work is already tracked where it belongs:
   `docs/work-breakdown.md` holds M6 (`pnpm doctor`, backup and restore, `flows:export`/`flows:import`,
   `docs/ingestion.md`, `docs/operations.md`) and the retrieval evaluation; the knowledge-base question is
   decision 20 in `docs/decisions.md`. The report and demo video are hand-in items, not repo work.
2. Remove the blockquote banner from the top of `AGENTS.md`. No other file links to `docs/HANDOVER.md`.
3. For every `docs/specs/*.md` whose `pr:` numbers are all merged on `main` and whose `status` is
   `in review`, set `status: merged`. The one exception is `2026-11-23-handover.md`, set to
   `superseded by 2026-11-23-retire-handover.md`.
4. Set `pr: "#32"` on `2026-11-22-setup-cli-plan.md` (the docs PR that added the setup CLI to the plan).

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Delete `docs/HANDOVER.md` | Rewrite it as a current status page | Its intro asks for deletion once done, and a second status page would drift from `docs/work-breakdown.md` and `docs/architecture.md`'s status table again |
| Change only `status` (and one missing `pr:`) in merged specs | Also fix content drift found in the review | Merged specs are frozen records (`docs/specs/README.md`). The one drift worth noting is recorded below instead |
| Leave Markdown out of Prettier, as `.prettierignore` does | Format every `.md` with Prettier | Prettier would rewrite 104 files and pad each table row to the widest cell (hundreds of characters in `docs/decisions.md`), which reads worse in raw Markdown. A scripted check of all 111 docs found no broken links or anchors, unclosed code fences, heading jumps or uneven tables |

Content drift noted, not edited: `2026-11-23-interactive-setup-cli.md` (#66) describes the model picker
as an arrow-key `select` with `maxItems: 10`. As merged, `scripts/setup.ts` uses a type-to-filter
`autocomplete` when there are more than 10 options and `select` otherwise.

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

No code changes. To check by hand:

- `git grep -n HANDOVER` finds nothing.
- `grep -L '^status: \(merged\|superseded\)' docs/specs/2*.md` lists only this spec.

## Out of scope and follow-ups

- The other review findings get their own PRs: focus after deleting a conversation in the admin UI, and
  exports that nothing imports.
- Keeping spec status in step from now on: whoever merges a PR sets its spec to `merged` in the next PR
  that touches `docs/specs/`, as the `docs(specs): mark ... merged` commits already do.

## Docs updated

`AGENTS.md` (banner removed); `docs/HANDOVER.md` deleted; the front matter of 57 older specs.
