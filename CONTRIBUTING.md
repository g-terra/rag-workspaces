# Contributing to rag-workspaces

Thanks for helping. This page is how a change gets from an idea to `main`: setting up a dev machine, the
workflow every change follows, how commits and releases work, which tests to run, and what a pull request
needs before it can merge.

AI coding agents follow the same rules, written for them in [AGENTS.md](AGENTS.md). Where the two ever
disagree, AGENTS.md wins; please open an issue so we can fix this page.

- [Set up a dev machine](#set-up-a-dev-machine)
- [How a change is made](#how-a-change-is-made)
- [Commits](#commits)
- [Releases](#releases)
- [Tests and checks](#tests-and-checks)
- [Pull requests](#pull-requests)
- [Where things live](#where-things-live)

## Set up a dev machine

You need Node 22.18+ and pnpm 10 (`corepack enable` gives you the version pinned in `package.json`), plus
Docker with Compose v2 for the stack and the end-to-end tests.

```bash
git clone https://github.com/g-terra/rag-workspaces.git
cd rag-workspaces
pnpm install          # dependencies, plus the Git hook that checks commit messages
pnpm run setup        # writes .env, picks the models, starts the stack (see docs/setup.md)
```

To work on one app with hot reload against the running stack:

```bash
pnpm --filter @rag/api dev     # the API on http://localhost:3000, Swagger at /docs
pnpm --filter @rag/admin dev   # the admin UI on http://localhost:5173, forwarding /api to the API
```

Stop the container for whichever app you run yourself (`docker compose stop api`) so the ports don't clash.

**Never commit secrets.** `.env` holds generated passwords and keys and is ignored by Git. Stage files by
name (`git add path/to/file`), never `git add -A` or `git add .`, and look at `git status` before every
commit. Provider API keys never go into Langflow's environment ([poc/RESULTS.md](poc/RESULTS.md), F3).

## How a change is made

Every change, however small, goes through the same five steps. They come from
[Superpowers](https://github.com/obra/superpowers), which Claude Code users install with
`/plugin install superpowers@claude-plugins-official` (the repo's `.claude/settings.json` offers it when
you trust the folder). Without Claude Code, follow the steps by hand.

1. **Design it.** Work out what the change is for and how it will work, and write that down as the PR's
   spec (below). Read [docs/decisions.md](docs/decisions.md) first: a decided item is not reopened in
   code, it is raised with the owner.
2. **Plan it.** Break the design into small steps. The plan is your working notes; it stays out of the
   repo.
3. **Test first.** Write a failing test for each behaviour, then the code that makes it pass.
4. **Get it reviewed.** Read your own diff as a reviewer would, against the rules on this page. Claude
   Code users can run the `reviewer` agent in `.claude/agents/`.
5. **Verify it.** Run the checks and look at the output before you say it works.

### Every PR adds a spec

A spec is a short design record in `docs/specs/`, one per pull request. Together they are the history of
how the system got to where it is, so someone arriving months later can read why, not just what.

1. Copy [docs/specs/TEMPLATE.md](docs/specs/TEMPLATE.md) to `docs/specs/YYYY-MM-DD-<topic>.md`.
2. Fill every section, writing "None." where one doesn't apply.
3. Commit it with the change, set its `pr:` once the PR is open, and link it from the PR description.

After the merge a spec is frozen except for its `status`. A later change writes a new spec instead of
editing an old one. [docs/specs/README.md](docs/specs/README.md) has the details, and Claude Code users
have the `write-spec` skill.

### Two house rules

- **Add nothing before it is needed.** No code, dependency, config, script or folder lands until
  something in the same PR uses it. No placeholders, "for later" exports or unused options.
- **Keep docs true.** When behaviour changes, update the doc that describes it (the README,
  `docs/architecture.md`, `docs/api-schema.md`, `docs/decisions.md`, the guides) in the same PR.

## Commits

Every commit message and PR title follows [Conventional Commits](https://www.conventionalcommits.org):

```text
type(scope): summary in the imperative

Optional body: why, not how.
```

| Type | Use it for | Release effect |
|---|---|---|
| `feat` | Something a user, operator or agent can now do | minor bump (while below 1.0) |
| `fix` | A bug fix | patch bump |
| `perf` | Faster, same behaviour | patch bump |
| `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert` | Everything else | none |

The scope names the part you changed: an app or package (`api`, `admin`, `mcp`, `db`, `flows`), an area
(`search`, `answers`, `setup`, `infra`), or `specs` for a commit that only touches a spec. Add `!` after the scope (`feat(api)!: ...`) for a
breaking change.

`pnpm install` sets up a Git hook (husky + commitlint) that rejects a message in the wrong shape, and CI
checks every commit in a PR and the PR title again.

## Releases

Versions follow [semantic versioning](https://semver.org) and are worked out from the commit messages by
[release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`). Nobody
edits a version or `CHANGELOG.md` by hand.

1. Every push to `main` updates one release pull request, `chore(main): release x.y.z`, with the next
   version and the changelog entries.
2. The owner merges it when a release is wanted. That tags `vX.Y.Z`, creates the GitHub release, sets the
   version in the API's `package.json` (shown in Swagger), and publishes the images
   `ghcr.io/g-terra/rag-workspaces-api` and `ghcr.io/g-terra/rag-workspaces-admin`, tagged `X.Y.Z`, `X.Y`
   and `latest`.

## Tests and checks

Run these before you push. CI (`.github/workflows/ci.yml`) runs the same six on every pull request.

```bash
pnpm format:check     # Prettier (pnpm format fixes it)
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm test             # Vitest in every package
pnpm test:scripts     # node:test for scripts/
pnpm build
```

Database tests in `packages/db` and `apps/api` run only when `TEST_DATABASE_URL` points at a Postgres you
don't mind being written to; CI starts a throwaway one.

Two slower suites run a whole throwaway stack in Docker, with a small stand-in model instead of a real one:

| Command | What it checks | Runs in CI |
|---|---|---|
| `pnpm smoke` | The compose stack end to end: sign-in, the local names, a workspace, uploads through ingestion into Chroma, search, answers and chat settings (about 5 minutes) | On PRs touching `apps/api`, `packages`, `flows`, `langflow`, `docker` or the compose files, and nightly on `main` |
| `pnpm e2e` | The admin UI's Playwright tests on that same stack | On PRs touching `apps/admin` or the stack, and nightly on `main` |

Run the one that matches your change locally before you push. `pnpm smoke --keep` leaves the stack up on
ports 13000 (API), 18080 (admin UI) and 18081 (Keycloak), with the login in `.env.smoke`. `pnpm e2e
upload.spec.ts` runs one file. To run the end-to-end tests against your own stack instead:

```bash
pnpm --filter @rag/admin exec playwright install chromium   # once
set -a; source .env; set +a                                 # the seeded admin's login
pnpm --filter @rag/admin e2e
```

## Pull requests

- **Small and focused.** One topic per PR, roughly 200 to 600 changed lines. Split bigger work into a
  stack of PRs, each based on the previous branch.
- **The title** is a Conventional Commit, because it becomes the squash or merge message.
- **The description** has two sections, both required:
  - **What to understand before approving**: the concepts, decisions and trade-offs in the change, and
    anything that is hard to undo (migrations, data, public routes, settings).
  - **How to review**: which files to read in what order, and how to run or check it locally.
- **Link the spec** from the description.
- **CI is green**, including the smoke and end-to-end runs when they apply.
- **The owner approves and merges.** Nothing lands on `main` without that.

## Where things live

| Path | What it is |
|---|---|
| `apps/api` | Fastify API, the REST routes and Swagger |
| `apps/admin` | Admin UI (Vite, React, Tailwind, shadcn/ui), with Playwright tests in `e2e/` |
| `apps/mcp` | MCP server over stdio for agents |
| `packages/db` | Drizzle schema, SQL migrations and the Postgres connection |
| `packages/langflow-client` | Typed client for Langflow's API |
| `packages/shared` | zod schemas shared by the API and the admin UI (the API contract) |
| `packages/config` | Shared TypeScript, ESLint and Vitest settings |
| `flows/` | Langflow flows as JSON, imported on every Langflow start |
| `langflow/components/` | Custom Langflow components (Python) |
| `docker-compose.yml`, `docker/` | The stack, images, Postgres init, Keycloak realm, Caddy proxy |
| `scripts/` | `setup`, `env-init` and the smoke and e2e runners |
| `docs/` | Architecture, API schema, decisions, setup, guides and specs |
| `poc/`, `spike/` | The Langflow proof of concept and later spikes, kept as a record |

[docs/architecture.md](docs/architecture.md) explains how they fit together.
