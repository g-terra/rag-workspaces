---
title: rewrite the README as a welcoming front page
date: 2026-11-23
pr: "#115"
status: in review
areas: [docs]
---

# Rewrite the README as a welcoming front page

## Summary

The README becomes a front page for someone landing on the repo: a centred hero with a one-line pitch,
badges, a playground screenshot (with a dark-mode variant), a features list, a gallery of four screens, a
three-command quick start, a mermaid diagram of how the parts fit, a docs table, the COS512 background with
the brief's route mapping, and a pointer to CONTRIBUTING. The long operational sections move to the pages
that already cover their subject: the address table, local names and "Updating an existing install" go to
`docs/setup.md`; the admin UI walkthrough is replaced by the user guide; the MCP section by
`docs/guide/api-keys.md`. No code changed.

## Why

The owner asked to make the README "more user friendly and attractive" (2026-11-23). It had grown into a
200-line operations manual: a status note, the route mapping, addresses, local-name and upgrade
instructions, a one-paragraph tour of every admin page, and the MCP setup, with no picture of the product.
The contributing guide (2026-11-23-contributing-guide.md) and the user guide (2026-11-23-user-guide.md)
now hold the detail, so the README can introduce the project and send people onward.

## Design

- `README.md`, top to bottom: hero (title, pitch, badges, nav links, screenshot in a `<picture>` element so
  GitHub's dark theme shows `docs/images/playground-answer-dark.png`), "What it does" (seven bullets),
  a 2x2 table of screenshots, "Quick start", "How it works" (a mermaid flowchart GitHub renders, and two
  sentences on the API/Langflow split), "Documentation" (a table), "Background" (COS512 and the route
  mapping, kept because the assignment report cites it), "Contributing".
- `docs/setup.md`: gains "Where everything is" (the address table, the `/etc/hosts` line, the
  `PROXY_PORT` note, moved verbatim) under step 1, and "Updating an existing install" (moved verbatim)
  under "Stopping, updating, starting over". Its references to "the README's" sections now point inside
  the page or to the guide.
- `docs/api.md` and `docs/guide/configuration.md`: links that pointed at removed README sections now point
  to the guide and setup.
- Badges: CI and smoke-test workflow status, the latest release, Conventional Commits, and static badges
  for the stack (TypeScript, Langflow 1.13.3, ChromaDB, Keycloak, Docker Compose), from shields.io.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A mermaid diagram | The architecture PNG from the report (figure 1) | The PNG predates the Caddy proxy and the MCP server, and can't be edited in a PR; mermaid is text, reviewed and kept true like the rest |
| Hero shot from the stand-in stack, with a caption | A real-model shot from the owner's `ouc` workspace | Needs the owner's live sign-in and puts course material in a public README; the caption is honest about it and a later PR can swap the file |
| Move setup detail into `docs/setup.md` | Keep it in the README, collapsed in `<details>` | One home per subject; setup.md already pointed back to these sections |
| Drop the status note and the work-breakdown link | Keep them | The status note was stale ("the admin UI (M4)"); the work breakdown is a planning record, still linked from AGENTS.md and architecture |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None.

## Testing

Docs only. Checked that every link and anchor in the README, `docs/setup.md`, `docs/api.md` and the guide
resolves (the moved sections keep their headings, so `#updating-an-existing-install` and
`#where-everything-is` exist), that nothing else in the repo links the removed README anchors, and that the
mermaid block renders on GitHub. `pnpm format:check` passes.

## Out of scope and follow-ups

- Real-model screenshots for the hero and the playground pages.
- A LICENSE file and its badge: the repo has none, and choosing one is the owner's call.

## Docs updated

`README.md` (rewritten), `docs/setup.md` (gains the moved sections), `docs/api.md` and
`docs/guide/configuration.md` (links), `docs/images/playground-answer-dark.png` (new). Main gained
response styles (#105), the Keycloak theme (#104) and the walkthrough (#107) while this was open, so the
README's lines on the last two went to `docs/setup.md` and `docs/guide/README.md`, and the guide's
"Coming soon" note on styles in `docs/guide/playground.md` became a real section.
