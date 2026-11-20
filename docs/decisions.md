# Decisions and open choices

## Settled (from the brief)

- Turborepo monorepo, TypeScript everywhere we write code.
- Langflow for the RAG flow; a vector database for storage.
- Everything runs in Docker with a single `docker compose up`.
- Inputs: PDF, DOCX, TXT, MD; optional video via Whisper.
- Admin UI with drag-and-drop upload and progress; Tailwind + ready-made components; modern look.
- API documented with Swagger/OpenAPI.
- Tests integrated into CI.
- Design mocks are reviewed before frontend build starts.

## Open choices, with recommendations

Each choice below has a recommendation the plan already assumes. Changing one is cheap now and expensive after M1.

### 1. Vector database: **Qdrant** (recommended)

| Option | For | Against |
|---|---|---|
| **Qdrant** | First-class Langflow component, simple single container, payload filtering (by course), good TS client, web dashboard for debugging | One more service to run |
| pgvector | Reuses Postgres, one fewer container, SQL joins with metadata | Langflow integration is less polished; tuning HNSW in Postgres is fiddlier |
| Chroma | Very simple | Weaker filtering and ops story; TS client less mature |

### 2. LLM and embedding provider: **local by default (Ollama), hosted optional**

"Tool is agnostic" is read as: no provider is hard-wired. Default `.env` uses Ollama (`nomic-embed-text` for embeddings, a small instruct model for answers) so it runs fully offline. Switching to OpenAI-compatible or Anthropic is an env change. Needs a call: which hosted provider, if any, should be the documented "best quality" setup.

### 3. Who embeds during ingestion: **our worker** (recommended) vs a Langflow ingestion flow

Our worker gives fine-grained progress, retries and testable code. A Langflow ingestion flow is easier to tweak visually but progress reporting and error handling are coarse. Langflow still owns the query flow either way.

### 4. API framework: **Fastify + zod** (recommended) vs NestJS

Fastify with zod gives the OpenAPI spec straight from the same schemas the UI and CLI import, with little boilerplate. NestJS is heavier but more opinionated if the team prefers its structure.

### 5. Admin UI framework: **Vite + React SPA** (recommended) vs Next.js

The admin is an internal tool behind the API; it needs no server rendering. A static SPA served by nginx is the simplest container. Next.js would add a Node server for little gain.

### 6. Whisper runtime: **faster-whisper ASR web service** (recommended) vs whisper.cpp vs OpenAI Whisper API

faster-whisper runs well on CPU and GPU in a ready-made container with an HTTP API. Hosted Whisper is simplest but sends lectures to a third party. Model size (`small` vs `medium`) to be decided by transcription quality on a sample lecture.

### 7. Auth model: **API keys with `read` and `admin` scopes** (recommended)

Enough for a self-hosted tool used by a person and their agents. SSO or user accounts can come later if the tool is shared.

### 8. Package manager: **pnpm** (recommended)

Best fit with Turborepo workspaces and fast, disk-efficient installs in CI and Docker.
