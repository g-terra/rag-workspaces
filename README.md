<div align="center">

# rag-workspaces

**Your own material, answered with citations, for people and AI agents.**

A self-hosted RAG platform built on Langflow. Load files into isolated **workspaces**, and each one gets an
admin UI, a documented REST API and an MCP server that answer from that material and cite where the
answer came from.

[![CI](https://github.com/g-terra/rag-workspaces/actions/workflows/ci.yml/badge.svg)](https://github.com/g-terra/rag-workspaces/actions/workflows/ci.yml)
[![Smoke test](https://github.com/g-terra/rag-workspaces/actions/workflows/smoke.yml/badge.svg)](https://github.com/g-terra/rag-workspaces/actions/workflows/smoke.yml)
[![Release](https://img.shields.io/github/v/release/g-terra/rag-workspaces?sort=semver)](https://github.com/g-terra/rag-workspaces/releases)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fe5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org)
<br>
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Langflow 1.13.3](https://img.shields.io/badge/Langflow-1.13.3-7528FC)
![ChromaDB](https://img.shields.io/badge/ChromaDB-vectors-FF6446)
![Keycloak](https://img.shields.io/badge/Keycloak-OIDC-4D4D4D?logo=keycloak&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

[Quick start](#quick-start) · [User guide](docs/guide/README.md) · [API](docs/api.md) ·
[Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/playground-answer-dark.png">
  <img src="docs/images/playground-answer.png" alt="The admin UI's playground: a question answered from a workspace's material, with numbered citations and their sources" width="900">
</picture>
<br><sub>The playground on a test stack with a stand-in model. With a real model, the answer is written from the cited passages.</sub>

</div>

## What it does

- **Workspaces keep material apart.** `ouc` for course material, `personal` for your notes: each has its own
  documents, vector index, settings, members and API, and nothing leaks between them.
- **Drop in files, or whole folders.** PDF, DOCX, TXT and Markdown, plus MP4, MP3 and WAV transcribed by
  Whisper. Each file is followed live through ingestion, and duplicates are skipped.
- **Import a documentation website.** Give a start URL and the site is crawled politely (robots.txt, sitemap,
  page and depth limits), each page becomes a document, and citations link back to the page. Crawl again to
  pick up what changed.
- **Answers that cite their sources.** Ask, search passages with their scores, or chat with follow-ups.
  Every answer streams in with numbered citations that point to the page, or the moment in a recording,
  in a response style you pick: academic, talkative, concise or tutor.
- **A real API for agents and scripts.** Resource-style REST routes with Swagger, workspace-scoped API keys
  (`reader` or `editor`), rate limits, and an MCP server for Claude Desktop, Claude Code and other clients.
- **Local first, hosted when you want.** Runs on LM Studio on your own machine by default; OpenAI, Gemini or
  Anthropic per workspace, with keys stored encrypted.
- **See how it's used.** Requests, latency, tokens, top questions, most cited documents, answer feedback and
  a full request log, per workspace or across all of them.
- **Accounts and roles.** Keycloak sign-in, a global admin role, and reader or editor access per workspace.
  Conversations are private to whoever asked.

<table>
  <tr>
    <td width="50%"><img src="docs/images/documents.png" alt="Documents: the workspace's library, live"><br><sub><b>Documents</b>: the library, with each file's status live</sub></td>
    <td width="50%"><img src="docs/images/playground-search.png" alt="Search mode: passages with scores"><br><sub><b>Search</b>: passages and their scores, no model call</sub></td>
  </tr>
  <tr>
    <td><img src="docs/images/usage.png" alt="Usage analytics"><br><sub><b>Usage</b>: requests, latency, top questions and cited documents</sub></td>
    <td><img src="docs/images/settings.png" alt="Workspace settings"><br><sub><b>Settings</b>: models, retrieval, provider keys and members</sub></td>
  </tr>
</table>

## Quick start

You need Docker with Compose, Node 22.18+ with pnpm 10 (`corepack enable`), about 6 GB of free memory for
the containers, and either [LM Studio](https://lmstudio.ai) or a key for OpenAI, Gemini or Anthropic.

```bash
git clone https://github.com/g-terra/rag-workspaces.git && cd rag-workspaces
pnpm install
pnpm run setup      # checks your machine, writes .env, picks the models, starts the stack
```

The setup wizard prints where to sign in when it's done. Your login is `RW_ADMIN_USERNAME` /
`RW_ADMIN_PASSWORD` from `.env`.

| Open | For |
|---|---|
| http://rag.localhost | The admin UI |
| http://api.rag.localhost/docs | The API and its Swagger UI |
| http://langflow.rag.localhost | The Langflow editor, where the flows live |
| http://auth.rag.localhost/admin | Keycloak's console, where you create people |

[Setup](docs/setup.md) explains each step, the `localhost` ports to use if those names don't open, updating
an existing install, and what to do when something goes wrong.

Then ask a workspace from a script:

```bash
curl -s http://api.rag.localhost/v1/workspaces/ouc/answers \
  -H "Authorization: Bearer rw_..." -H 'content-type: application/json' \
  -d '{ "question": "What is retrieval-augmented generation?" }'
```

## How it works

```mermaid
flowchart LR
  people["People<br/>(browser)"] --> proxy["Caddy<br/>*.rag.localhost"]
  agents["Agents and scripts<br/>(REST, MCP)"] --> proxy
  proxy --> admin["Admin UI<br/>React"]
  proxy --> api["API<br/>Fastify + Swagger"]
  admin --> api
  api --> keycloak["Keycloak<br/>sign-in"]
  api --> postgres[("Postgres<br/>app data, queue, usage")]
  api -- "runs flows by name" --> langflow["Langflow<br/>ingest, search, answer"]
  langflow --> chroma[("ChromaDB<br/>one collection per workspace")]
  langflow --> models["LM Studio on the host,<br/>or a hosted provider"]
```

The API does the bookkeeping (who may do what, the ingest queue, conversations, usage) and leaves the AI
to Langflow. The AI work (loading, splitting, embedding, retrieval, prompting, generation) lives in
Langflow flows committed as JSON in `flows/`, which the API runs by name. [Architecture](docs/architecture.md)
has the full picture, and [Decisions](docs/decisions.md) the reasons behind each choice.

## Documentation

| | |
|---|---|
| [User guide](docs/guide/README.md) | Workspaces, uploads, the playground, API keys and agents, providers, usage, every setting |
| [Setup](docs/setup.md) | From a clone to a first answer, models, people, troubleshooting |
| [Using the API](docs/api.md) | Authentication and examples for scripts and agents |
| [Tuning answer quality](docs/tuning.md) | How answers were measured, and the settings that came out of it |
| [Architecture](docs/architecture.md) | Components, data flow, trust boundaries, repo layout |
| [API schema](docs/api-schema.md) | Every resource, route and shape |
| [Decisions](docs/decisions.md) | What is settled, and why |
| [Change specs](docs/specs/README.md) | One design record per pull request: how the system got here |
| [Contributing](CONTRIBUTING.md) | Dev setup, workflow, commits, releases, tests and PR rules |

## Background

rag-workspaces started as the project for the COS512 Langflow assignment at the Open University of Cyprus
(Option 4: expose AI interactions via an API), and `ouc` was its first workspace. The brief's example
endpoints map to these routes (no aliases, [decision 6](docs/decisions.md)):

| Brief | Route |
|---|---|
| `/ask` | `POST /v1/workspaces/{slug}/answers` |
| `/chat` | `POST /v1/workspaces/{slug}/conversations/{id}/messages` |
| `/retrieve` | `GET /v1/workspaces/{slug}/passages?query=…` |
| Usage analytics | `GET /v1/usage/…` and `GET /v1/workspaces/{slug}/usage/…` |

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the dev setup, the
workflow every change follows, commit and release rules, the test suites and what a pull request needs.
