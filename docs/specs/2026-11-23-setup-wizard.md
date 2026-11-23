---
title: guided setup with pnpm run setup
date: 2026-11-23
pr: "#53"
status: merged
areas: [infra, ci, docs]
---

# Guided setup with `pnpm run setup`

## Summary

`pnpm run setup` (`scripts/setup.ts`) takes a fresh clone, or a broken install, to a running stack:

1. It checks Node (22.18+), Docker and Docker Compose v2.
2. It checks that the published ports are free and names the program holding one (it skips this when the
   stack is already running).
3. It writes `.env` through `scripts/env-init.ts`.
4. It asks for the chat and embedding provider and model, then writes the four `DEFAULT_*` settings and
   any provider key.
5. It runs `docker compose up --detach --build --wait`, waits for `GET /ready`, and prints the sign-in
   URLs.

`--yes` asks nothing and keeps what `.env` has, for scripts and CI. It is also what happens when stdin is
not a terminal.

## Why

Plan item 14 in docs/work-breakdown.md (spec `2026-11-22-setup-cli-plan.md`, PR #32): Guilherme asked for it
on 2026-11-22. Setup was five manual steps, and each one went wrong at least once during review. A marker
installing the project for the assignment (M7) meets the same steps.

## Design

1. **Re-runnable.** Every question offers the current `.env` value as its default. Secrets come from
   `env-init.ts`, which never changes an existing value. Only settings that differ are written back. A changed
   line is edited where it is; a new one is added under `# Added by pnpm run setup`
   (`scripts/setup/env-file.ts`, `setEnv`).
2. **Models.**
   - LM Studio: the wizard reads `LMSTUDIO_BASE_URL/models` from the host (`host.docker.internal` becomes
     `localhost`). It splits the ids into chat and embedding models by name (`/embed/i`) and offers each list
     by number.
   - Hosted providers: the wizard asks for the key without echoing it, then lists the provider's models
     with the same calls `GET /v1/system` makes. It warns when the key is refused or the model id isn't
     offered.
   - A provider that can't be reached is a warning, not a failure, so the stack still starts and the
     problem shows in the admin UI.
   - Anthropic isn't offered for embeddings.
3. **Ports.** It tries to listen on `PROXY_PORT`, `API_PORT`, `WEB_PORT`, `LANGFLOW_PORT` and `KEYCLOAK_PORT`
   (from `.env`, else the defaults) and names the holder with `lsof`. A taken port stops the wizard with the
   fix (stop that program, or change the port).
4. **Output.**
   - It prints the admin username, and says the password is `RW_ADMIN_PASSWORD` in `.env` rather than
     printing it, so a CI log or a shared terminal doesn't show it.
   - It prints the URLs from `ADMIN_UI_URL`, `PUBLIC_API_URL` and `KEYCLOAK_PUBLIC_URL`.
5. **Tests.** `scripts/` has no package, so its tests use `node:test` and run with `pnpm test:scripts`, a new
   CI step.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| `pnpm run setup` | `pnpm setup`, as the plan said | `pnpm setup` is pnpm's own built-in command (it sets up pnpm's home directory) and always wins over a script. The docs say `run` everywhere |
| No "create the first workspace" step | Create it from the wizard | That needs an admin access token, and password login is off in the realm. It is one click in the admin UI |
| Keep `pnpm env:init` and call it | Fold it into the wizard | CI, the README's update steps and people who don't want questions still use it; one place makes secrets |
| `node:readline` and `node:test`, no dependencies | `@inquirer/prompts`, Vitest | A few prompts don't need a library, and the scripts run without installing anything beyond Node |
| No `pnpm doctor` yet | Build it alongside | Rule 1: nothing before it's needed. It can reuse these checks when it is built |
| Unreachable provider is a warning | Stop the wizard | You may start LM Studio after the stack; `GET /v1/system` and the admin UI show it until then |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: writes the existing `DEFAULT_CHAT_PROVIDER`, `DEFAULT_CHAT_MODEL`,
  `DEFAULT_EMBEDDING_PROVIDER`, `DEFAULT_EMBEDDING_MODEL`, and `OPENAI_API_KEY`, `GEMINI_API_KEY` or
  `ANTHROPIC_API_KEY`. No new settings.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.
- **Commands**: `pnpm run setup [--yes]` and `pnpm test:scripts` in the root `package.json`. CI runs
  `pnpm test:scripts` after `pnpm test`.

## Operations

None. Existing installs can run `pnpm run setup --yes` after a `git pull` instead of `env:init` plus
`docker compose up -d --build`.

## Testing

- `scripts/setup/env-file.test.ts` (`pnpm test:scripts`) covers four helpers:
  - `parseEnv`.
  - `setEnv`: in-place edits, comments kept, new keys appended, no change when nothing differs.
  - `splitModels`.
  - `hostUrl`.
- By hand in this environment, with the image build replaced by prebuilt images (this sandbox can't run
  `docker build` directly):
  - `--yes` on an old `.env` that was missing `KEYCLOAK_DIRECTORY_SECRET`: the wizard added the secret
    and the four model settings, LM Studio being down was a warning, and every service ended healthy with
    `/ready` ok.
  - Interactive in a pseudo-terminal against a fake LM Studio listing four models: it offered the two chat
    and two embedding models by number and wrote the chosen ones. The second run found the stack running
    and skipped the port check.
  - Choosing OpenAI: the key prompt didn't echo the key (checked in the captured terminal output), and the
    key was written to `.env`.

## Out of scope and follow-ups

- `pnpm doctor`, reusing these checks.
- Creating the first workspace, once there is a way to sign in from a script.

## Docs updated

- `README.md`: "Run the stack" starts with `pnpm run setup`.
- `docs/setup.md`: step 1 and the update row.
- `AGENTS.md`: commands.
- `docs/work-breakdown.md`: item 14 and the M7 row.
