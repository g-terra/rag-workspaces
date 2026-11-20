# Decisions

Decided items are Guilherme's calls (all on 2026-11-20 unless dated otherwise). Open items list a recommendation.

## Decided

| # | Decision | Rationale |
|---|---|---|
| 1 | **TypeScript throughout, not Flask or FastAPI** | See below; the reasoning is written for the report |
| 2 | **Workspaces**: dynamic, isolated groups of material, each with its own collection, routes, keys, analytics and optional settings | One install serves study material (`ouc`), personal notes (`personal`) and anything else without data leaking between them. The repo was renamed `rag-workspaces` to match |
| 3 | **Ingestion runs as a Langflow flow**; the API keeps the bookkeeping | Keeps all AI logic (loading, splitting, embedding) in Langflow, as the assignment intends, and visible in the flow editor. Trade-off: progress is per file, not per chunk |
| 4 | **ChromaDB**, one collection per workspace | Single server container, first-class Langflow component, metadata filtering. FAISS is a library with no server or filtering; Weaviate is heavier than needed. None of them parses files themselves |
| 5 | **LM Studio** on the host as the default model provider | Runs offline; its server speaks the OpenAI API, so any OpenAI-compatible provider is a config change. CI uses a stub server instead |
| 6 | **Our own resource-oriented API schema**, no `/ask` `/chat` `/retrieve` aliases | Answers and conversations become stored records, which makes analytics and feedback natural; see [API schema](api-schema.md) and its mapping table |
| 7 | **Answer feedback** (up/down + comment) kept | Gives analytics a quality signal |
| 8 | **Keycloak** for login, accounts created by admins only | Standard OIDC, runs in compose with a pre-imported realm; no self sign-up for a personal tool |
| 9 | **API keys created by admins only**, bound to workspaces, role `reader` or `editor` | Keys reach outside the system, so only admins issue them; workspace binding enforces isolation |
| 10 | Turborepo + pnpm monorepo, Tailwind + shadcn/ui, Swagger docs, Docker Compose, tests in CI, design mocks approved before frontend build | From the original brief |

### Why TypeScript instead of Flask or FastAPI

- **One language end to end.** API and admin UI share one codebase and one set of zod schemas; the UI's types are generated from the API's OpenAPI spec, so they cannot drift.
- **Same capabilities as FastAPI.** Fastify with zod gives typed request validation and an auto-generated OpenAPI spec with Swagger UI, which is what FastAPI is usually chosen for.
- **The AI logic still lives in Langflow**, as the brief requires: ingestion, answering and chat are Langflow flows committed as JSON. Langflow, Keycloak and Whisper run as published container images, so the project writes no Python.
- **Turborepo** gives cached builds and tests across all packages.

## Supporting choices (proposed, fine to change)

| Choice | Proposed | Alternative |
|---|---|---|
| API framework | Fastify + zod | NestJS |
| Admin UI | Vite + React SPA served by nginx | Next.js |
| Ingestion queue | BullMQ on Redis, one file at a time per workspace | Postgres-backed queue (one fewer service) |
| Video | faster-whisper ASR container, compose profile `video` | Hosted Whisper API |
| Folders inside a workspace | Optional, used as a filter | Tags only |
| Per-workspace settings | Chat model, embedding model, system prompt, chunk size and overlap, top-k | Global settings only |

## Open

| Question | Recommendation |
|---|---|
| How does our API get its Langflow API key? | API creates it on first start using the Langflow superuser from `.env`, stores it, and reports it in `/ready`; fallback is pasting `LANGFLOW_API_KEY` into `.env` |
| Which direction(s) of Langflow integration? Our API calling Langflow flows, Langflow flows calling our passages API with a workspace key, or both | Both: the API runs the flows, and agent flows in Langflow can use our API as a tool |
| Document a hosted model provider? | Yes, as an optional setting in `docs/setup.md` (any OpenAI-compatible endpoint); LM Studio stays the default |
