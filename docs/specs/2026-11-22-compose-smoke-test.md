---
title: Compose smoke test for the ingestion path
date: 2026-11-22
pr: '#34'
status: in review
areas: [ci, infra]
---

# Compose smoke test for the ingestion path

## Summary

`pnpm smoke` brings up the whole compose stack as a separate throwaway project, with a stand-in
OpenAI-compatible model server in place of LM Studio, signs in through the real Keycloak, creates a
workspace, uploads a PDF, a DOCX and a Markdown file, waits until they are ready and checks that the
passages really landed in Chroma with the right metadata. A new GitHub Actions workflow runs it on pull
requests that touch the stack and nightly on `main`.

## Why

Work breakdown, Workstream 3 item 9 (`docs/work-breakdown.md`): the real Langflow flows are only
exercised against the full stack, so the compose smoke test starts in M1 and grows each milestone. It
was planned for M1 but not built with #15 and #16; until now the ingest path was only checked by hand
(see the Testing section of `2026-11-20-ingest-queue.md`). The stand-in model server is the one the
Langflow spike used (`poc/standin/server.ts`, `poc/RESULTS.md`).

## Design

1. `docker-compose.smoke.yml`, an overlay on `docker-compose.yml`:
   - adds a `standin` service (`node:22.23-alpine` running `poc/standin/server.ts`, mounted read-only)
     with a health check;
   - points the API at it (`LMSTUDIO_BASE_URL=http://standin:1234/v1`) and lets Langflow call it
     (`LANGFLOW_SSRF_ALLOWED_HOSTS` adds `standin`);
   - makes `api` and `langflow` wait for `standin` to be healthy;
   - publishes Chroma on `127.0.0.1:${CHROMA_PORT}` so the checks can count vectors.
2. `scripts/smoke/stack.ts up|down|logs`: runs `docker compose` with project name
   `rag-workspaces-smoke`, both compose files and `--env-file .env.smoke`. `up` writes a new `.env.smoke`
   whenever the project has no containers (fresh secrets, the same way `pnpm env:init` does, plus the smoke ports and URLs below)
   and runs `docker compose up -d --build --wait`. `down` removes the containers and volumes. Kept
   separate from the checks so other suites (the admin UI's Playwright tests) can reuse the stack.
3. `scripts/smoke/check.ts`: the checks, against a running smoke stack:
   1. turns on the password grant for the `admin-ui` client in that stack's Keycloak with `kcadm.sh`
      inside the container (never in the realm file), using the Keycloak admin login from the
      container's own environment so it never appears in a command line or log;
   2. gets a token for the seeded admin from Keycloak and calls `GET /v1/me` (expects `isAdmin`);
   3. creates workspace `smoke-<timestamp>`;
   4. uploads `poc/samples/ouc/cos512-notes.pdf`, `assignment-brief.docx` and `langflow-tips.md` in one
      request;
   5. polls each document until `ready` (fails fast on `failed`, with the document's error);
   6. for each document, reads its vectors from Chroma collection `ws_<slug>` (`where document_id`) and
      checks the count equals `passageCount`, the PDF's passages all carry a `page` of 1 or more, and the
      DOCX and MD passages carry no page;
   7. deletes the workspace and checks the Chroma collection is gone.

   Each step prints one line; the first failure exits non-zero with what was expected and what came
   back.
4. `scripts/smoke/run.ts` (`pnpm smoke`): `up`, `check`, then `down`, also when the check fails;
   prints every service's state and recent logs on failure. `--keep` leaves the stack running for debugging.
5. `.github/workflows/smoke.yml`: one job on `ubuntu-latest` that runs `node scripts/smoke/run.ts` (no `pnpm install` needed). Triggers:
   pull requests touching `flows/`, `langflow/`, `docker/`, `apps/api/`, `packages/`, the compose
   files, `.env.example`, `.dockerignore`, `package.json`, `pnpm-lock.yaml`, `poc/standin/` or
   `scripts/smoke/` (and the workflow itself); nightly at 03:00 UTC on `main`;
   manual dispatch.

## Decisions and trade-offs

| Decision                                                | Alternatives considered                                       | Why this one                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stand-in runs as a compose service in an overlay        | Run it on the host on port 1234 via `host.docker.internal`    | On a laptop, 1234 is LM Studio's port; a container needs no free host port and makes local and CI runs identical                                                |
| Separate compose project and ports                      | Reuse the dev stack (`rag-workspaces`, default ports)         | The test creates and deletes data and tears down volumes; it must never touch the owner's dev stack                                                            |
| Password grant switched on with `kcadm.sh` at test time | A test client in `realm.json`; password grant in the realm   | Nothing test-only ships in the real realm; the token comes from the real `admin-ui` client, so the audience mapper and roles are the ones the UI gets          |
| Zero-dependency Node scripts (`node *.ts`)              | A Vitest suite under `apps/api`; Playwright                   | No new dependencies (rule 1), keeps the slow stack test out of `pnpm test`; Playwright arrives with the admin UI                                                |
| Fixtures from `poc/samples/ouc/`                        | Copy them into `scripts/smoke/fixtures/`                      | The same files the spike and route tests use; no binary duplicates. If `poc/` is ever removed, move them then                                                  |
| Chroma counted directly, not through the API            | Count through `rw-retrieve` or a passages route              | The point is to prove what the flow wrote; the passages routes are not on `main` yet (#18), and the smoke test grows to them after they merge                  |
| PR trigger by paths, plus nightly                       | Every PR; nightly only                                        | The stack takes minutes to pull and start; docs-only PRs don't need it, and nightly catches image or dependency drift                                          |

## Interfaces and contracts

- **HTTP API**: None changed. The checks call `GET /v1/me`, `POST /v1/workspaces`,
  `POST /v1/workspaces/{slug}/documents`, `GET /v1/workspaces/{slug}/documents/{id}` and
  `DELETE /v1/workspaces/{slug}`.
- **Configuration**: `.env.smoke` (gitignored), written by `scripts/smoke/stack.ts up`: the generated
  secrets from `.env.example`, plus `API_PORT=13000`, `WEB_PORT=18080`, `KEYCLOAK_PORT=18081`,
  `LANGFLOW_PORT=17860`, `CHROMA_PORT=18000`, `PUBLIC_API_URL`, `ADMIN_UI_URL` and `KEYCLOAK_PUBLIC_URL`
  on those ports, and `DEFAULT_EMBEDDING_MODEL=standin-embed-a`. The seeded admin is
  `RW_ADMIN_USERNAME` / `RW_ADMIN_PASSWORD` in that file. Other suites rely on these names and ports.
- **Data**: None. The smoke stack has its own volumes, removed by `down`.
- **Langflow**: None changed. Exercises `rw-ingest` and `rw-delete` through the API.
- **Events and logs**: None.

## Operations

Needs Docker with Compose v2.20+ (for `--wait`). Running `pnpm smoke` locally pulls the same images as
the dev stack and builds the `api` and `web` images; it does not touch the dev stack, `.env` or LM
Studio. A stack left behind by `--keep` or an interrupted run is removed with
`node scripts/smoke/stack.ts down`.

## Testing

The smoke test is itself the test. Checked by hand that it fails for the right reason: with the
stand-in stopped the documents end `failed` and the run exits non-zero with the document's error, and
with the password grant step skipped the login fails. Run it locally with `pnpm smoke` (about five
minutes on a cold machine); `pnpm smoke --keep` leaves the stack up at the ports above.

## Out of scope and follow-ups

- Search, answers, chat and usage checks: added by the PRs after #18, #19/#20, #21 and #22 merge.
- Recording Langflow responses for the MSW stubs (Workstream 3 item 6).
- The admin UI's Playwright tests reuse `stack.ts` and `.env.smoke`; they add their own CI step.
- Answer quality: needs real models, so it stays a local `pnpm eval` run (Workstream 3 item 11).

## Docs updated

- `AGENTS.md`: `pnpm smoke` in the commands, when the smoke workflow runs, the `--keep` ports.
- `README.md`: `pnpm smoke` in Development, `scripts/smoke` in the paths table.
- `.gitignore` and `.dockerignore`: `.env.smoke` (the api and web builds copy the whole repo, so
  without it the smoke secrets would land in an image layer).
- `docs/work-breakdown.md`: none needed; item 9 already describes this.
