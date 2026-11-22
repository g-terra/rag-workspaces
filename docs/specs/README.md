# Change specs

One spec per pull request, written before or alongside the code, that records **what changed and why**.
Together they are the history of the system's design: an agent or person who arrives later reads the
specs to learn how the code got to where it is, without digging through PRs and chats.

## Specs and the other docs

| Doc | Describes | Changes when |
| --- | --- | --- |
| `docs/architecture.md`, `docs/api-schema.md`, `docs/decisions.md`, `flows/README.md` | The system **as it is now** | Every PR that changes what they describe (AGENTS.md rule 6) |
| `docs/specs/*.md` | **One change**: the problem, the design, the trade-offs, the contracts it adds | Written in its PR; after merge only `status` changes |

A merged spec is a record, not a manual: don't rewrite it when the code later changes. Write a new spec
for the new change, and set the old one's `status` to `superseded by <new file>` if it replaces it.

## Writing one

1. Copy [TEMPLATE.md](TEMPLATE.md) to `docs/specs/YYYY-MM-DD-<topic>.md` (the date you start, a short
   kebab-case topic).
2. Fill every section. Keep every heading; write "None." where one doesn't apply.
3. Commit it in the same PR as the change, set `pr:` once the PR is open, and keep it true as review
   changes the code.
4. Link it from the PR description.

Agents: the `write-spec` skill (`.claude/skills/write-spec/SKILL.md`) walks through this, and AGENTS.md
rule 7 makes it required.

## Reading them

`ls docs/specs` lists them in date order; within a day, the `pr:` number in each file's front matter
gives the order. Specs dated 2026-11-20 to 2026-11-22 were written after the fact for the first build
PRs, from their descriptions and diffs.
