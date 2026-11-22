---
name: write-spec
description: Write the change spec that every pull request in rag-workspaces must include (docs/specs/YYYY-MM-DD-topic.md from docs/specs/TEMPLATE.md). Use it whenever you are about to change code, config, flows or docs in this repo, and before opening or updating a PR.
---

# Write the change spec

Every PR in this repo adds one spec in `docs/specs/` (AGENTS.md rule 7). The spec is the lasting record
of what the PR changed and why, for the next agent or person. Specs all follow
`docs/specs/TEMPLATE.md`, so they read the same.

## When

- **Before coding**, as soon as the change is clear: write the spec with status `proposed`. If you are
  using Superpowers' `brainstorming` skill, this spec **is** its design document: save it here, in this
  template, instead of `docs/superpowers/specs/`.
- **While coding**, keep it true. When review or testing changes the design, change the spec in the
  same push.
- **When the PR opens**, set `pr:` to its number and `status: in review`, and link the spec from the PR
  description.

One PR, one spec. A stacked PR gets its own spec; don't append to the previous one.

## Steps

1. Read `docs/specs/README.md` and the most recent specs touching the same area (`grep -l "areas:.*api"
   docs/specs/*.md`), so you build on what is there and use the same words.
2. Copy the template: `cp docs/specs/TEMPLATE.md docs/specs/$(date +%F)-<topic>.md`. The topic is
   short kebab-case, for example `2026-11-23-rate-limits.md`.
3. Fill the front matter: `title` (the PR title without its type), `date`, `pr` (`pending` until it
   exists), `status`, `areas`.
4. Fill every section. Rules:
   - Keep every heading. Write "None." under one that doesn't apply.
   - Name real files, routes, env vars, tables and flow node ids. No vague "updated the service".
   - **Why** links the decision number in `docs/decisions.md` or the earlier spec it builds on.
   - **Decisions and trade-offs**: one table row for each choice a reviewer could question, with the
     alternative you rejected.
   - **Interfaces and contracts** is what other code depends on: HTTP API, configuration, data, Langflow,
     events and logs. Be exact; this is the part future agents rely on.
   - **Operations**: what an existing install must do (migrations, volumes, `.env` changes), and what is
     hard to undo.
   - **Testing**: name the test files, and give commands to check it by hand.
   - Delete the template's HTML comments.
5. **Docs updated**: if the change alters anything `docs/architecture.md`, `docs/api-schema.md`,
   `docs/decisions.md`, `README.md` or `flows/README.md` describes, update that doc in the same PR
   (rule 6) and list it here.
6. Run `pnpm format:check` (Prettier formats Markdown too), then commit the spec with the change. If
   the spec is the only thing in a commit, use `docs(specs): ...`.

## Don't

- Don't edit a merged spec except its `status` (`superseded by <file>`). Write a new one instead.
- Don't put secrets, real hostnames or personal data in a spec.
- Don't copy the whole diff. The spec explains; the code is the detail.
