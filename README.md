# rag-workspaces

A self-hosted RAG platform built on Langflow. You create **workspaces** (for example `ouc` for study material, `personal` for your own notes), load files into each one, and every workspace gets its own isolated, documented API that people and AI agents can query.

Material is loaded locally (PDF, DOCX, TXT, MD, and optionally video via Whisper), indexed into ChromaDB through Langflow flows, and served through a REST API with Swagger docs, Keycloak login, workspace-scoped API keys, usage analytics, and an admin UI with drag-and-drop upload and live progress.

The first workspace, `ouc`, is the project for the COS512 Langflow assignment (Option 4: expose AI interactions via an API).

> Status: **planning**. Nothing is implemented yet.

- [Architecture](docs/architecture.md): components, workspaces, data flow, repo layout
- [API schema](docs/api-schema.md): resources, routes and shapes
- [Work breakdown](docs/work-breakdown.md): milestones and the four workstreams
- [Decisions](docs/decisions.md): what is settled, what is open, and why
