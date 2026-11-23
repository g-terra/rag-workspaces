# Decisions

Decided items are Guilherme's calls (all on 2026-11-20 unless dated otherwise). Nothing is open at the moment.

## Decided

| # | Decision | Rationale |
|---|---|---|
| 1 | **TypeScript throughout, not Flask or FastAPI** | See below; the reasoning is written for the report |
| 2 | **Workspaces**: dynamic, isolated groups of material, each with its own collection, routes, keys, analytics and optional settings | One install serves study material (`ouc`), personal notes (`personal`) and anything else without data leaking between them. The repo was renamed `rag-workspaces` to match |
| 3 | **Ingestion runs as a Langflow flow**; the API keeps the bookkeeping | Keeps all AI logic (loading, splitting, embedding) in Langflow, as the assignment intends, and visible in the flow editor. Trade-off: progress is per file, not per chunk |
| 4 | **ChromaDB**, one collection per workspace | Single server container, first-class Langflow component, metadata filtering. FAISS is a library with no server or filtering; Weaviate is heavier than needed. None of them parses files themselves |
| 5 | **LM Studio** on the host as the default model provider | Runs offline; other providers are a setting (see 19). CI uses a stub server instead |
| 6 | **Our own resource-oriented API schema**, no `/ask` `/chat` `/retrieve` aliases | Answers and conversations become stored records, which makes analytics and feedback natural; see [API schema](api-schema.md) and its mapping table |
| 7 | **Answer feedback** (up/down + comment) kept | Gives analytics a quality signal |
| 8 | **Keycloak** for login, accounts created by admins only | Standard OIDC, runs in compose with a pre-imported realm; no self sign-up for a personal tool |
| 9 | **API keys created by admins only**, bound to workspaces, role `reader` or `editor` | Keys reach outside the system, so only admins issue them; workspace binding enforces isolation |
| 10 | Turborepo + pnpm monorepo, Tailwind + shadcn/ui, Swagger docs, Docker Compose, tests in CI, design mocks approved before frontend build | From the original brief |
| 11 | **Conversation history lives in our database only**; the chat flow is stateless and receives the last turns from the API | One place for history, one delete, and tests do not depend on Langflow's stored state. The flow still does retrieval, prompting and generation |
| 12 | **Accounts are created in Keycloak's own admin console**; our admin UI lists people read-only and grants workspace access | No second user-management screen to build; it can be added later through Keycloak's admin API |
| 13 | **MCP server as a thin stdio client of the REST API** (`apps/mcp`). Was "left for later"; built on 2026-11-23 when Guilherme asked for every planned feature | It runs on the agent's machine with an `rw_` API key, so it adds no service to the stack and no second way in: roles, workspace isolation, rate limits and the usage log apply as for any caller |
| 14 | **No due date drives the plan**; the whole thing is built over the weekend of 21 November 2026 | M2 stays marked as the point where everything graded exists, as a safety net |
| 15 | **The ingestion queue runs on Postgres (pg-boss); no Redis** | One database for everything. The queue handles one file at a time for one install, so a second data service, client library and test container bought nothing. Live status needs no pub/sub with a single API process |
| 16 | **The database schema and the Langflow client stay separate packages** (`packages/db`, `packages/langflow-client`) | Separation of concerns. The review suggested folding them into `apps/api` because only the API uses them; declined |
| 17 | **The API gets its Langflow key automatically** on first start (signing in as the Langflow superuser from `.env`); `LANGFLOW_API_KEY` in `.env` is the fallback | Nothing to paste on a fresh install |
| 18 | **One direction: the API calls Langflow.** Flows read ChromaDB directly and never call our API; no API keys for Langflow | Simpler, no loop between the two, and one less key type to explain |
| 19 | **Hosted model providers are a setting**: LM Studio stays the default; OpenAI, Google Gemini, Anthropic (chat only, it has no embedding models) and any OpenAI-compatible endpoint can be configured, globally or per workspace | Lets a workspace trade privacy for quality where wanted. A hosted provider receives that workspace's passages and questions, and the UI says so |
| 20 | **Keep ChromaDB through small custom Langflow components** (from the M0 spike, PR #3) | Langflow 1.13 retired its Chroma integration. Custom components over Chroma's REST API keep the ChromaDB decision and also give delete by document id, idempotent re-ingest and scored passages, which the stock component never did. Rejected: pinning Langflow 1.12 (frozen on an old line) or Langflow's Postgres knowledge bases (ties storage to Langflow users, not workspaces) |
| 21 | **Answers and conversations are private** to the person or key that created them, plus admins; other workspace members get 404 | Questions can be personal. Confirmed by Guilherme on 2026-11-20 while reviewing the answers PR; workspace usage analytics still count them |
| 22 | **Local names over plain HTTP**: a Caddy proxy serves `rag.localhost`, `api.rag.localhost`, `auth.rag.localhost` and `langflow.rag.localhost`, and the localhost ports stay as a fallback | Names are easier to remember and to show in the demo than four ports, and `*.localhost` resolves to the machine in browsers with no hosts file. No HTTPS: browsers treat `localhost` names as secure contexts, so sign-in works, and local certificates would need a trust step on every machine. Approved by Guilherme on 2026-11-23 |
| 23 | **Provider keys can be saved per workspace** from the admin UI, encrypted in Postgres (AES-256-GCM under `SECRETS_KEY` from `.env`), never returned, and used instead of `.env`'s key for that workspace. `.env` stays the fallback | Guilherme wanted to enter a Gemini key in the UI rather than edit `.env` and restart, and chose per-workspace keys over one global key on 2026-11-23. Keys never reach Langflow's environment (F3): they still travel as tweaks per run |
| 24 | **Response styles are added after the system prompt, never in place of it**. Four are built in (`academic`, `talkative`, `concise`, `tutor`); one can be chosen per question or as a workspace default. Custom styles will be one list shared by every workspace, managed by admins | Guilherme asked for academic, talkative and similar personalities on 2026-11-23, and chose shared custom styles over per-workspace ones. Appending keeps the tuned grounding rules (citations, refusals, complete lists) in force whatever the style; a workspace's own system prompt can still replace them, as before, and then a style only reminds the model that the rules above still apply |

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
| Video | faster-whisper ASR container, compose profile `video` | Hosted Whisper API |
| Folders inside a workspace | Optional, used as a filter | Tags only |
| Per-workspace settings | Chat model, embedding model, system prompt, chunk size and overlap, top-k, minimum score | Global settings only |
| Passage retrieval | A fourth flow, `retrieve.json`, backs the passages endpoint | The API embeds the query and calls Chroma itself (puts AI logic outside Langflow) |
| Running flows | By fixed endpoint name with tweaks on named components; contract in `flows/README.md`, checked in CI | By flow id |
| Workspace roles | `reader` and `editor` for people and keys alike; one realm role, `admin` | Separate vocabularies for people and keys |
| API key storage | `rw_` prefix, 32 random bytes, SHA-256 hash | bcrypt or argon2 (slower, not needed for random secrets) |
| Retrieval evaluation | Run locally against real models, results committed and used in the report | Nightly in CI (cannot work with a stub model) |
| Published ports | Bound to `127.0.0.1`; databases not published | Open on all interfaces |
