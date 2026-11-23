# Handover

Written 2026-11-23 so another agent (Google Antigravity, or any other tool) can pick up the work without
the chat history it came from. Read this first, then [AGENTS.md](../AGENTS.md), the [README](../README.md)
and the docs it links. When this file and the code disagree, the code and the long-lived docs win; update
this file or delete it once the work below is finished.

## What the project is

- **Assignment.** COS512 (OUC MSc) Langflow assignment, **Option 4: expose AI interactions through an
  API**: an API that wraps Langflow, with usage analytics, tests and documentation.
- **Deliverables to hand in:** the source code including the Langflow flow JSON (`flows/*.json`), a
  **3 to 5 page report**, and a **3 to 5 minute demo video**. Report and video are **not started**.
- **The product.** `rag-workspaces`: a self-hosted RAG platform. Material lives in isolated
  **workspaces** (for example `ouc` for the course material, `personal`), each with its own ChromaDB
  collection, routes (`/v1/workspaces/{slug}/...`), API keys and analytics. The repo was renamed from
  `g-terra/ouc-materials-api`; GitHub redirects the old name.
- **Owner:** Guilherme (GitHub `g-terra`). He reviews and approves; see the working rules.

## Architecture in one screen

Full version: [docs/architecture.md](architecture.md), routes in [docs/api-schema.md](api-schema.md),
settled choices in [docs/decisions.md](decisions.md) (22 decisions, **don't reopen them in code**; raise
them with the owner).

| Part | Where | What it does |
| --- | --- | --- |
| API | `apps/api` | TypeScript, Fastify + zod, Swagger at `/docs`. All bookkeeping: workspaces, uploads, sha256 dedupe, pg-boss ingest queue on Postgres, statuses with SSE, answers, conversations, feedback, API keys, usage log and analytics, rate limits, folders, reindex, `/v1/system`, `/v1/users` |
| Database | `packages/db` | Drizzle schema and migrations on Postgres |
| Langflow client | `packages/langflow-client` | Runs flows by endpoint name with tweaks keyed by fixed node ids |
| Flows | `flows/*.json` | ingest, retrieve, answer, chat, delete. All AI logic lives here. Imported by Langflow on every start; contract in [flows/README.md](../flows/README.md). Pinned to **Langflow 1.13.3** |
| Custom components | `langflow/` | Chroma components over Chroma's REST API (Langflow 1.13 dropped its Chroma integration, decision 20) |
| Admin UI | `apps/admin` | Vite + React, Tailwind + shadcn/ui, TanStack Query, React Router, oidc-client-ts (Keycloak, code + PKCE) |
| MCP server | `apps/mcp` | stdio MCP server for agents; a thin client of the REST API using an `rw_` key (decision 13) |
| Stack | `docker-compose.yml`, `docker/` | Postgres, ChromaDB, Langflow, Keycloak (realm imported), API, admin UI, Caddy for `*.rag.localhost` |
| Scripts | `scripts/` | `setup.ts` wizard, `env-init.ts`, `smoke/` (smoke stack, stand-in model, e2e runner) |

Key decisions to keep in mind: TypeScript only, no Python service (decision 1, rationale written for the
report); one direction, the **API calls Langflow** and flows never call the API (18); ingestion is a
Langflow flow, the API does bookkeeping (3); chat history only in our database, flows are stateless (11);
Keycloak login, accounts created in Keycloak's console (8, 12); API keys admin-created only, workspace-bound,
`reader`/`editor` (9); answers and conversations private to the asker plus admins (21); LM Studio on the
host is the default model provider, OpenAI, Gemini, Anthropic (chat only) and OpenAI-compatible endpoints
are settings (5, 19); **provider API keys never go in Langflow's environment** (poc/RESULTS.md F3).

## Run and test

Node 22.18+, pnpm 10 (`corepack enable`), Docker. LM Studio on the host for real answers.

```sh
pnpm install          # dependencies and the commit-message hook
pnpm run setup        # wizard: checks, .env with fresh secrets, model provider, starts compose, prints URLs
                      # (`--yes` for no questions; plain `pnpm setup` is pnpm's own command)
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:scripts && pnpm build
pnpm smoke            # whole stack + stand-in model, end to end (~5 min); --keep leaves it running
pnpm e2e              # admin UI Playwright tests against the smoke stack
```

- URLs: admin UI `http://rag.localhost`, API and Swagger `http://api.rag.localhost/docs`, Langflow
  `http://langflow.rag.localhost`, Keycloak `http://auth.rag.localhost/admin`. Localhost ports 8080, 3000,
  7860 and 8081 are the fallback. Logins come from `.env` (see the README table).
- Smoke stack ports: API 13000, admin UI 18080, Keycloak 18081; login in `.env.smoke`.
- CI (`.github/workflows/ci.yml`) runs the six checks on every PR; `smoke.yml` and `e2e.yml` run on PRs
  that touch the stack or `apps/admin`, and nightly on `main`.
- Owner's machine: macOS, zsh, 48 GB RAM, LM Studio. His own Langflow sometimes holds port 7860.
- Guides: [docs/setup.md](setup.md), [docs/api.md](api.md).

## Working rules

The full list is in [AGENTS.md](../AGENTS.md). In plain steps:

1. **Design first.** Before code, write the change spec: copy [docs/specs/TEMPLATE.md](specs/TEMPLATE.md)
   to `docs/specs/YYYY-MM-DD-<topic>.md` and fill every section (write "None." where one doesn't apply).
   Read the recent specs for the area first. One spec per PR, linked from the PR description; after merge
   only its `status` changes.
2. **Plan** the change as small steps in your scratch space (not committed).
3. **Test first.** Write the failing test, make it pass, refactor (Vitest in packages, `node:test` for
   `scripts/`, Playwright in `apps/admin`).
4. **Review** your own diff against AGENTS.md and the decisions before opening the PR
   (`.claude/agents/reviewer.md` is a usable checklist).
5. **Verify** by running the checks above (and `pnpm smoke` / `pnpm e2e` when the stack or admin UI
   changed) before saying anything is done. Show the output, don't claim.
6. **Small PRs**, one topic, roughly 200 to 600 changed lines, branched off `main`. Every PR description
   has **What to understand before approving** and **How to review** sections.
7. **Conventional Commits** for every commit and PR title (`feat(api): ...`, `fix(admin): ...`,
   `docs: ...`). A hook and CI enforce it; release-please builds versions and the changelog from them.
8. **Add nothing before it is needed**: no dependency, config, script or folder until the same PR uses it.
9. **Keep docs true** in the same PR (architecture, api-schema, decisions, flows/README, README).
10. **Never commit secrets.** `.env` is ignored. Stage files by name, never `git add -A`.
11. **Code links**: when pointing the owner at code, use GitHub permalinks with the commit SHA and line
    ranges, e.g. `https://github.com/g-terra/rag-workspaces/blob/<sha>/apps/api/src/app.ts#L10-L40`.
12. **Merging.** Standing approval from the owner (2026-11-23): build PRs may be merged once CI is green.
    Use merge commits. **Release PRs from release-please (currently #43, v0.2.0) are his to merge.**

## Done

All of these are merged on `main` (PRs up to #53):

- M0 foundation and Langflow spike (`poc/`, `poc/RESULTS.md`), monorepo, CI, release-please.
- M1 workspaces and ingestion: CRUD, Chroma collection per workspace, upload, dedupe, pg-boss queue, live
  SSE status, retry, delete, reindex (`POST /v1/workspaces/{slug}/reindex`, also how the embedding model
  changes).
- M2 passages (search), answers with streaming, conversations, feedback, Keycloak auth, API keys, usage
  log and analytics, compose smoke test.
- Backend extras: `GET /v1/users` (Keycloak `api-directory` client), `GET /v1/system` (service and
  provider health, model lists), local names via Caddy, rate limits, folders and folder filter, MCP server
  (`apps/mcp`), `docs/setup.md` and `docs/api.md`, the `pnpm run setup` wizard (#53).
- M3 design mocks approved: https://claude.ai/artifact/MNwpBspDrYYg4Cy4NkGV51
- M4 admin UI, first half: sign-in, workspace list and create, upload, live status, document library,
  Playwright e2e in CI.

## In flight

### Admin UI (M4, second half)

All branches are pushed to `origin`, in two stacks. Each stack starts from `main` and each branch is based
on the one above it, so **merge in order and retarget the next PR to `main` after each merge**. Every
branch carries its own spec in `docs/specs/2026-11-23-admin-*.md`. Approved mocks for these screens:
https://claude.ai/artifact/MNwpBspDrYYg4Cy4NkGV51 (Playground, Conversations, ApiKeys, Usage, Settings
boards).

Track A, playground:

| # | Branch | What | State |
| --- | --- | --- | --- |
| A1 #55 | `claude/project-thread-mr58qn-08-playground-ask` | Ask mode, answers streamed over fetch SSE; SSE parser in `apps/admin/src/api` | done |
| A2 #56 | `claude/project-thread-mr58qn-08b-playground-citations` | `[n]` citations, passage with neighbours, link to the document | done |
| A3 #57 | `claude/project-thread-mr58qn-08c-answer-feedback` | thumbs up/down with a comment | done |
| A4 #58 | `claude/project-thread-mr58qn-09-playground-search` | Search mode, passages with scores | done |
| A5 #59 | `claude/project-thread-mr58qn-09b-playground-chat` | Chat mode, conversation with streamed replies | done, reviewed, tests green |
| A6 #64 (draft) | (stacked on #59) | Conversations page `/w/:slug/conversations`: list, open, continue, delete | works and tests pass; **5 reviewer findings still open, listed in the PR description** (main one: deleting a conversation leaves an error pane) |

Track B, admin pages:

| # | Branch | What | State |
| --- | --- | --- | --- |
| B1 #54 | `claude/project-thread-mr58qn-11-api-keys` | list, create with copy-once secret, edit, revoke; fixes the vite `/api` proxy prefix | done |
| B2 #60 | `claude/project-thread-mr58qn-12-usage` | usage analytics, global and per workspace | done |
| B3 #61 | `claude/project-thread-mr58qn-13-settings` | workspace settings, reindex, model pickers from `GET /v1/system` (it merged `main`, so its diff against B2 also shows backend specs) | done |
| B4 #62 (draft) | `claude/project-thread-mr58qn-13b-members` | members with the `GET /v1/users` picker, delete workspace | pushed just before the stop; **run the checks and `pnpm e2e` first** |

PRs are open: track A is #55 → #56 → #57 → #58 → #59 → #64, track B is #54 → #60 → #61 → #62 (#55 and #54
are based on `main`). #64 and #62 are drafts: #64 has open review findings, #62's final checks are not confirmed. The specs on these branches still say
`pr: pending`; set each one's PR number before merging. The branch `claude/project-thread-mr58qn-05-library` is stale and can be deleted.

### Backend: M5 video, part 1 (no PR yet)

Branch `claude/project-thread-ufzllz-video` (head `2ecc01c`), started from `main` at `bc590db`, before the
setup wizard (#53). **Merge `main` into it before opening the PR.**

Done on the branch (234 API tests, lint, typecheck, format and the full smoke test pass):

- MP4, MP3 and WAV detected by content (`detectType`, `isMedia` in `apps/api/src/services/storage.ts`);
  migration `0008_media_types.sql` adds them to the `document_type` enum.
- `WHISPER_URL` config; without it a media upload gets a 415 that names the video profile.
- `whisper` compose service, profile `video`: image `onerahmet/openai-whisper-asr-webservice:v1.10.0`,
  `ASR_ENGINE=faster_whisper`, model from `WHISPER_MODEL` (default `base`), volume `whisper-models`.
  `.env.example` has `COMPOSE_PROFILES=video` and `WHISPER_URL=http://whisper:9000` commented out.
- `apps/api/src/services/whisper.ts` (`WhisperClient`) posts to `/asr?output=json`, keeps segment start,
  end and text. `IngestProcessor` moves a media document `transcribing` → `processing` → `ready`, saves
  `<file>.transcript.json` next to the upload, and reuses it on retry or reindex.
- `langflow/components/rag_workspaces/document_loader.py` groups segments into rows of at most 600
  characters or 60 s with `start_seconds` and `end_seconds`; the copy embedded in `flows/ingest.json` is
  updated. A new test in `apps/api/src/flows.test.ts` fails when code embedded in a flow differs from its
  `langflow/components/*.py` file.
- Route `GET /v1/workspaces/{slug}/documents/{id}/transcript`; deleting a document deletes its transcript.
- Smoke: the stand-in model server (`poc/standin/server.ts`) answers `/asr`, the smoke compose sets
  `WHISPER_URL=http://standin:1234`, and a smoke step checks the transcript route and `start_seconds` in
  Chroma.

Still to do on it:

1. The spec `docs/specs/2026-11-23-video-transcription.md`.
2. Docs: a "Video and audio" section in `docs/setup.md` (the 415 message already points there); say
   uploads are capped at 200 MB (`MAX_UPLOAD_BYTES` and nginx `client_max_body_size`) and suggest
   extracting audio to MP3 for long videos. Add the types and transcript route to `docs/api-schema.md`
   and remove "(planned)"; update the status table in `docs/architecture.md` and the README.
3. Merge `main`, open the PR.
4. One run with real Whisper (`COMPOSE_PROFILES=video`) on the owner's machine; only the stand-in was
   tested, because the cloud sandbox could not download models.

## Remaining, in priority order

The assignment's graded parts already exist on `main` (the M2 cut line in
[docs/work-breakdown.md](work-breakdown.md)), so the hand-in items come first.

1. **Land the admin UI stacks above**: fix the open findings on #64, confirm B4 (#62) passes, open or finish the PRs, merge in order.
2. **Report (3 to 5 pages).** Not started. Source material: `docs/architecture.md`, `docs/decisions.md`
   (the "Why TypeScript instead of Flask or FastAPI" section is written for it), the README's table mapping
   the brief's `/ask`, `/chat`, `/retrieve` to our routes, `poc/RESULTS.md`, and the retrieval evaluation
   (item 7) if it is done in time.
3. **Demo video (3 to 5 minutes).** Not started. Script from work-breakdown M7: sign in, create the `ouc`
   workspace, upload files, watch ingestion, ask and chat in the playground, search through Swagger with an
   API key, show usage analytics. Record on the owner's machine with LM Studio.
4. **Admin UI, not started:**
   1. Folders UI on the folder routes (#49) and folder filter (#50): folder sidebar in the library, upload
      into a folder, move a document, folder picker in the playground.
   2. Admin-only system status banner from `GET /v1/system` (LM Studio, Langflow or Chroma down) and a
      System section (work-breakdown, workstream 2 item 9).
5. **Backend:**
   1. M5 part 1, video and audio transcription: in review as #71. The 2 GB upload limit is #70.
   2. M5 part 2, start times on passages and citations: in review as #72 (stacked on #71).
   3. Admin UI for media (upload types, transcript panel, times on sources): in review as #73 (stacked
      on #72).
   4. M6, in order: `pnpm doctor` (reuse the checks in `scripts/setup.ts`); `pnpm backup` / `restore`;
      `flows:export` and `flows:import` (start from `poc/client/build-flows.ts`); `docs/ingestion.md`
      and `docs/operations.md`.
   5. Follow-up: configurable upload size for video (`MAX_UPLOAD_BYTES` in compose plus an nginx
      template).
6. **Retrieval evaluation** (work-breakdown, workstream 3 item 11): golden questions for the `ouc`
   workspace, recall@k and MRR, run locally against LM Studio with the results committed. Feeds the report.

## Open questions for the owner

- **PR #31 knowledge-base spike** (merged as a spike): stay on ChromaDB through custom components
  (decision 20, current) or move to Langflow's native knowledge bases. Unchanged until Guilherme decides;
  a switch would be its own follow-up PRs.
- **Embedding model**: `nomic` is the default; Qwen3-Embedding-4B (Q8_0) is downloaded on his machine.
  Changing a workspace's model means a reindex.
- **Still to check on his machine**: answer quality with LM Studio, and one real Gemini call.
- **Release PR #43** (v0.2.0) is waiting for him to merge.

## Other references

- Architecture page for the report: https://claude.ai/artifact/TXR5Tg24iB4nM2z7BcF919
- Blueprint: https://claude.ai/artifact/VM3Q7fiJuHDUGfwuMF4H3t
- API schema doc: https://claude.ai/artifact/1zJUCcRP7ou57vd2UFCB5m
- PR tracker: https://claude.ai/artifact/1vGPWNz8ZQxkHf5Bj9AB9p

These pages are private to the owner's claude.ai account; the repo docs hold the same facts.
