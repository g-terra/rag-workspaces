# ouc-materials-api

A self-hosted, Langflow-based RAG API that lets people and AI agents ask questions about OUC class materials (COS512 Langflow assignment, Option 4: expose AI interactions via an API).
Material is loaded locally (PDF, DOCX, TXT, MD, and optionally video via Whisper), indexed in a vector database,
and served through a documented REST API with an admin UI for drag-and-drop uploads and ingestion progress.

> Status: **planning**. Nothing is implemented yet. Start with the docs below.

- [Architecture](docs/architecture.md): components, data flow, API surface, repo layout
- [Work breakdown](docs/work-breakdown.md): milestones and the four workstreams (backend, frontend, testing/validation, design)
- [Decisions and open choices](docs/decisions.md): what is settled, what still needs a call, and the recommendation for each
