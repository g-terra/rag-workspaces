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
- Endpoints follow the assignment: `/v1/ask`, `/v1/chat`, `/v1/retrieve`, plus API usage analytics.
- Exported Langflow flow JSON is committed in `flows/`.

## Open choices, with recommendations

### 0. Language: TypeScript instead of Flask or FastAPI (decided by Guilherme, 2026-11-20)

The assignment brief suggests Flask or FastAPI for the API layer. This project uses TypeScript (Node 22, Fastify) throughout. Rationale for the report:

- **One language end to end.** API, ingestion worker, CLI helpers and admin UI share one codebase and one set of zod schemas. The request and response types the UI uses are generated from the same schemas that validate the API, so they cannot drift.
- **Same capabilities as FastAPI.** Fastify with zod gives typed request validation and an auto-generated OpenAPI spec with Swagger UI, which is what FastAPI is usually chosen for. Fastify is also one of the fastest Node web frameworks.
- **The AI logic still lives in Langflow.** The brief's core requirement, flow-based AI logic in Langflow, is unchanged: our API calls Langflow's run API, and the flow JSON is in the repo. Langflow and Whisper run as their published container images, so the project writes no Python.
- **LangChain.js covers the Python ecosystem we would otherwise want.** Document loaders, text splitters, OpenAI-compatible embeddings and the ChromaDB client all exist in LangChain.js.
- **Turborepo monorepo** gives cached builds and tests across all packages, which a mixed Python and TypeScript repo would make harder.

### 3b. Ingestion libraries: LangChain.js (decided by Guilherme, 2026-11-20)

The worker uses LangChain.js loaders (PDF, DOCX, text), text splitters, `OpenAIEmbeddings` pointed at LM Studio, and the LangChain Chroma vector store. This replaces hand-written parsers. Our code adds progress events, checksum dedupe, course metadata and retries around them.


Each choice below has a recommendation the plan already assumes. Changing one is cheap now and expensive after M1.

### 1. Vector database: **ChromaDB** (decided by Guilherme, 2026-11-20)

Guilherme asked for ChromaDB, FAISS or Weaviate. ChromaDB is chosen:

| Option | For | Against |
|---|---|---|
| **ChromaDB** (chosen) | Runs as a single server container; first-class Langflow component; official JS/TS client (`chromadb`); metadata filtering for courses; very simple to operate | Fewer tuning knobs than larger engines; fine at the scale of course material |
| FAISS | Fast, well known | A library, not a service: no server, no metadata filtering, persistence is files we would manage ourselves; no TS-native binding. Poor fit for a multi-service compose stack |
| Weaviate | Built-in vectorizer modules and hybrid (keyword + vector) search | Heavier to run and configure; more than this project needs. Worth revisiting if hybrid search turns out to matter |

None of these three does ingestion (reading PDFs/DOCX, chunking, transcription); they only store and search vectors. Our worker keeps that job (see choice 3). The vector store sits behind one adapter in `packages/ingestion-core`, so switching later touches one module plus the Langflow flow.

### 2. LLM and embedding provider: **LM Studio by default (decided by Guilherme, 2026-11-20), hosted optional**

"Tool is agnostic" is read as: no provider is hard-wired. The default `.env` points at LM Studio's OpenAI-compatible server on the host (`http://host.docker.internal:1234/v1`), with an embedding model (e.g. `nomic-embed-text`) and a chat model loaded in LM Studio, so it runs fully offline. Any OpenAI-compatible endpoint, or Anthropic, is an env change. LM Studio is not part of compose, so CI uses a small stub OpenAI-compatible server instead.

Still open: which hosted provider, if any, should be documented as the "best quality" setup.

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
