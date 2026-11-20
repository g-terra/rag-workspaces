# Working in this repository

Guidance for AI coding agents (Claude Code, Codex, Cursor and others). People are welcome to read it too.
`CLAUDE.md` only imports this file, so keep everything here.

## What this is

A self-hosted RAG platform built on Langflow: isolated **workspaces** of material, each with its own
documented REST API. Start with the [README](README.md), then:

- [docs/architecture.md](docs/architecture.md): components, data flow, repo layout
- [docs/api-schema.md](docs/api-schema.md): resources, routes and shapes
- [docs/decisions.md](docs/decisions.md): what is settled and why. Don't reopen a decided item in code;
  raise it with the owner instead
- [docs/work-breakdown.md](docs/work-breakdown.md): milestones
- [poc/RESULTS.md](poc/RESULTS.md): what the Langflow spike proved, and the workarounds it needed

## Rules

1. **Add nothing before it is needed.** No code, dependency, config file, script or folder lands until
   something in the same PR uses it. Put each in the PR that first needs it, not in an earlier
   "foundation" PR. No placeholders, no "for later" exports, no unused options.
2. **Small pull requests.** One topic per PR, roughly 200 to 600 changed lines, stacked on the previous
   branch when they depend on each other. Every PR description has two sections:
   - **What to understand before approving**: the concepts, decisions, trade-offs and anything hard to
     undo.
   - **How to review**: which files to read in what order, and how to run or check it locally.
3. **Conventional Commits** for every commit message and PR title: `type(scope): summary`, for example
   `feat(api): stream answers`. Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
   `chore`, `style`, `revert`; `!` after the scope marks a breaking change. A Git hook (installed by
   `pnpm install`) and CI enforce it. release-please derives versions and the changelog from these
   messages, so the type matters.
4. **Never commit secrets.** `.env` holds generated passwords and keys and is ignored. Stage files by
   name (`git add path/to/file`), never `git add -A` or `git add .`, and check `git status` before every
   commit. Provider API keys never go in Langflow's environment (see `poc/RESULTS.md`, F3).
5. **Don't merge without the owner's approval.** Open the PR, make CI green, and wait.
6. **Keep docs true.** When behaviour changes, update the doc that describes it in the same PR.

## Commands

```sh
pnpm install          # dependencies, plus the commit-message hook
```

## Langflow

The AI logic (loading, splitting, embedding, retrieval, prompting, generation) lives in Langflow flows
committed as JSON, pinned to Langflow 1.13.3. The API only calls Langflow, by endpoint name, passing
inputs as tweaks keyed by fixed node ids. The spike's flows, custom components and client are in `poc/`.
