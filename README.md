# rag-workspaces

A self-hosted RAG platform built on Langflow. You create **workspaces** (for example `ouc` for study material, `personal` for your own notes), load files into each one, and every workspace gets its own isolated, documented API that people and AI agents can query.

Material is loaded locally (PDF, DOCX, TXT, MD, and optionally video via Whisper), indexed into ChromaDB through Langflow flows, and served through a REST API with Swagger docs, Keycloak login, workspace-scoped API keys, usage analytics, and an admin UI with drag-and-drop upload and live progress.

The first workspace, `ouc`, is the project for the COS512 Langflow assignment (Option 4: expose AI interactions via an API).

> Status: **building milestone M0** (scaffold). The plan is in `docs/`, the Langflow proof of concept in `poc/`.

- [Architecture](docs/architecture.md): components, workspaces, data flow, repo layout
- [API schema](docs/api-schema.md): resources, routes and shapes
- [Work breakdown](docs/work-breakdown.md): milestones and the four workstreams
- [Decisions](docs/decisions.md): what is settled, what is open, and why

## Commits and releases

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`,
for example `feat(api): stream answers` or `fix(admin): keep the upload list sorted`. `pnpm install` sets up a
Git hook that checks each message, and CI checks pull request commits and titles. Types: `feat`, `fix`,
`perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`; add `!` (`feat(api)!: …`) for a
breaking change.

Versions follow [semantic versioning](https://semver.org) and are picked from those messages by
[release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`):

1. Every push to `main` updates a release pull request (`chore(main): release x.y.z`) with the next version
   and `CHANGELOG.md`. `fix` bumps the patch version; `feat` and breaking changes bump the minor version
   while we are below 1.0.
2. Merging it tags `vX.Y.Z` and creates the GitHub release.

## Development

Requirements: Node 22.18+ and pnpm 10 (`corepack enable` gives you the pinned version).

```bash
pnpm install
pnpm build       # build every package (Turborepo caches the results)
pnpm test        # Vitest in every package
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm format      # Prettier
```

| Path | What it is |
|---|---|
| `poc/` | The Langflow proof of concept (see `poc/RESULTS.md`) |

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, tests and build on every pull request.
