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

- **One language end to end.** API and admin UI share one codebase. The API's zod schemas produce the OpenAPI spec, and the UI's client is generated from that spec, so they cannot drift.
- **Same capabilities as FastAPI.** Fastify with zod gives typed request validation and an auto-generated OpenAPI spec with Swagger UI, which is what FastAPI is usually chosen for.
- **The AI logic still lives in Langflow**, as the brief requires: ingestion, answering and chat are Langflow flows committed as JSON. Langflow, Keycloak and Whisper run as published container images, so the project has no Python service. The flows may carry a few small custom components (Python inside the flow JSON) where stock ones fall short, for example to keep page numbers; that is Langflow work, and worth one sentence in the report.
- **Turborepo** gives cached builds and tests across all packages.

## Supporting choices (proposed, fine to change)

| Choice | Proposed | Alternative |
|---|---|---|
| API framework | Fastify + zod | NestJS |
| Admin UI | Vite + React SPA served by nginx | Next.js |
| Ingestion queue | BullMQ on Redis, one file at a time across the install (one local model server), configurable | Postgres-backed queue (one fewer service) |
| Video | faster-whisper ASR container, compose profile `video` | Hosted Whisper API |
| Folders inside a workspace | Optional, used as a filter | Tags only |
| Per-workspace settings | Chat model, embedding model, system prompt, chunk size and overlap, top-k, minimum score | Global settings only |
| Passage retrieval | A fourth flow, `retrieve.json`, backs the passages endpoint | The API embeds the query and calls Chroma itself (puts AI logic outside Langflow) |
| Running flows | By fixed endpoint name with tweaks on named components; contract in `flows/README.md`, checked in CI | By flow id |
| Workspace roles | `reader` and `editor` for people and keys alike; one realm role, `admin` | Separate vocabularies for people and keys |
| API key storage | `rw_` prefix, 32 random bytes, SHA-256 hash | bcrypt or argon2 (slower, not needed for random secrets) |
| Retrieval evaluation | Run locally against real models, results committed and used in the report | Nightly in CI (cannot work with a stub model) |
| Published ports | Bound to `127.0.0.1`; databases not published | Open on all interfaces |

## Open

| Question | Recommendation |
|---|---|
| How does our API get its Langflow API key? | API creates it on first start using the Langflow superuser from `.env`, stores it, and reports it in `/ready`; fallback is pasting `LANGFLOW_API_KEY` into `.env` |
| Which direction(s) of Langflow integration? Our API calling Langflow flows, Langflow flows calling our passages API with a workspace key, or both | Both: the API runs the flows, and agent flows in Langflow can use our API as a tool |
| Document a hosted model provider? | Yes, as an optional setting in `docs/setup.md` (any OpenAI-compatible endpoint); LM Studio stays the default |

### Raised by the plan review

These came out of the review on 2026-11-20. Each changes scope or the stack, so they are recommendations. Apart from the MCP move, nothing in the other docs assumes them yet.

| Question | Recommendation | Why |
|---|---|---|
| When is the assignment due? | Tell us the date; the plan treats M2 as the hand-in point either way | The deliverables were the last milestone, behind the admin UI, video and hardening. Everything graded exists at M2 |
| Keep Redis and BullMQ for the queue? | Use a Postgres-backed queue (pg-boss) and drop Redis | The queue runs one file at a time for one person. Postgres is already there; this removes a service, a client library and a test container. Live status needs no pub/sub with a single API process |
| Where does conversation history live? | In our `messages` table; the API sends the last turns to a stateless chat flow | Otherwise history lives twice (Langflow's memory and our table), deleting a conversation has to clean both, and tests need Langflow's state. The flow still does retrieval, prompting and generation |
| Four shared packages for two apps? | Keep `packages/shared` and `packages/config`; make the database schema and the Langflow client folders inside `apps/api` | Only the API uses them. Turborepo stays; there is just less wiring |
| Where are people's accounts created? | In Keycloak's own admin console for now; our admin UI lists them read-only and grants workspace access | A user-management screen duplicates what Keycloak already has. It can be added later through Keycloak's admin API |
| MCP server in the core plan? | Moved from M6 to "later" in the work breakdown; say if you want it back | Agents can use the REST API through OpenAPI today |
