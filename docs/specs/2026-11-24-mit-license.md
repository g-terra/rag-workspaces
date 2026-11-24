---
title: Add the MIT license
date: 2026-11-24
pr: pending
status: proposed
areas: [docs]
---

# Add the MIT license

## Summary

The repository is now licensed under the MIT License, copyright 2026 Guilherme Terra. A `LICENSE` file
sits at the root, every `package.json` declares `"license": "MIT"`, and the README shows a license badge
and a License section. Nothing about how the system runs changes.

## Why

The repo had no license, so by default nobody else had the right to use, copy or change it. The
[welcoming README spec](2026-11-23-welcoming-readme.md) left the LICENSE file and its badge out because
choosing one was the owner's call. The owner has now chosen MIT (project thread, 2026-11-24).

## Design

- `LICENSE`: the standard MIT text from the Open Source Initiative / choosealicense.com, unchanged apart
  from the year and the holder. GitHub detects it and shows "MIT license" on the repo page.
- `package.json` (root, `apps/admin`, `apps/api`, `apps/mcp`, `packages/config`, `packages/db`,
  `packages/langflow-client`, `packages/shared`, `poc`): `"license": "MIT"` after `"private": true`.
- `README.md`: a "License: MIT" badge next to the Conventional Commits badge, and a `## License`
  section at the end linking `LICENSE`.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Holder "Guilherme Terra" | "g-terra" (GitHub login) | It is the name on the owner's commits in this repo; a legal notice reads better with a person's name. |
| `license` in every `package.json`, not only the root | Root only | All packages are private and never published, but the field keeps each package's metadata honest and stops tools that read it per package from reporting "UNLICENSED". One line each. |
| Year 2026 only | A range | The project started in 2026. |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

None for an install. Licensing is hard to take back: copies taken under MIT keep that licence even if a
later version changes it. Third-party components (Langflow, Keycloak, ChromaDB and the npm and Python
dependencies) keep their own licences; this file covers only the code in this repo.

## Testing

No code changed. `pnpm format:check` covers the Markdown and JSON files. By hand: after merge, the repo
page on GitHub shows "MIT license" in the About panel, and the README badge links to `LICENSE`.

## Out of scope and follow-ups

- No licence headers in source files: the root `LICENSE` is enough for MIT.
- No `NOTICE` or third-party licence inventory.

## Docs updated

`README.md` (badge and License section).
