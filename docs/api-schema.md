# API schema

Resource-oriented REST API. Everything is under `/v1`; material-related resources live inside a workspace: `/v1/workspaces/{slug}/...`. The live, generated spec is at `/openapi.json` and Swagger UI at `/docs`.

Routes and fields marked *(planned)* are designed but not built yet; see the status table in
[architecture](architecture.md#status) and the change specs in [specs/](specs/).

## Conventions

| Convention | Rule |
|---|---|
| Versioning | `/v1`; breaking changes go to `/v2` |
| Auth | `Authorization: Bearer <token or key>`: a Keycloak access token (people) or an API key (agents and scripts) |
| Isolation | A caller only sees workspaces it is granted; others return 404, not 403, so their existence is not revealed |
| Ids | Prefixed ULIDs: `ws_`, `fld_`, `doc_`, `ans_`, `cnv_`, `msg_`, `key_`. Passages are `psg_<document ulid>_<chunk index>`, so they are stable across re-indexing with the same settings. Users are identified by their Keycloak user id. Workspaces are addressed by `slug` |
| Fields | JSON, camelCase, ISO 8601 UTC timestamps |
| Lists | `?limit=20&cursor=…` returns `{ "data": [...], "nextCursor": "…" | null }` |
| Errors | RFC 9457 problem JSON: `{ "type", "title", "status", "detail", "requestId" }`; validation errors add `errors: [{ "path", "message" }]`. See [errors](#errors) |
| Roles | One global role, `admin`. Inside a workspace, people and keys are `reader` or `editor` |
| Rate limits *(planned)* | Per key and per user; `429` with `Retry-After` and `RateLimit-*` headers |
| Streaming | `Accept: text/event-stream` on answers and messages streams `token`, `citations`, `done`, `error` events |
| Tracing | Every response has `X-Request-Id`, also stored in the usage log |

## Resources

| Resource | Path | Who |
|---|---|---|
| Workspace | `/v1/workspaces` | admin creates; members and keys see their own |
| Folder *(planned)* | `/v1/workspaces/{slug}/folders` | editor |
| Document | `/v1/workspaces/{slug}/documents` | editor to change, reader to list |
| Passage | `/v1/workspaces/{slug}/passages` | reader |
| Answer (+ feedback) | `/v1/workspaces/{slug}/answers` | reader; an answer is visible only to whoever asked and to admins |
| Conversation (+ messages) | `/v1/workspaces/{slug}/conversations` | reader; a conversation is visible only to whoever started it and to admins |
| Usage | `/v1/usage`, `/v1/workspaces/{slug}/usage` | admin (global), editor (own workspace) |
| User | `/v1/users` | admin |
| System | `/v1/system` | admin |
| API key | `/v1/api-keys` | admin |
| Me | `/v1/me` | anyone authenticated |

Outside `/v1`: `GET /health`, `GET /ready` (ok or not, no detail), `GET /openapi.json`, `/docs`. `GET /v1/system` gives admins the detail behind `/ready`: the state of Postgres, Chroma, Langflow (key and flows), Keycloak, and every model provider with the models it offers now, including whether the default models are among them. It always answers `200`; `status` is `degraded` when something is down.

```json
// GET /v1/system → 200 (admin only)
{ "version": "0.4.0", "status": "degraded",
  "services": [{ "name": "postgres", "ok": true, "latencyMs": 2, "error": null },
               { "name": "langflow", "ok": false, "latencyMs": 15, "error": "flows missing in Langflow: rw-chat" }],
  "langflowKey": "auto",
  "providers": [{ "id": "lmstudio", "configured": true, "reachable": true, "error": null, "embeddings": true,
                  "models": ["qwen2.5-7b-instruct", "text-embedding-nomic-embed-text-v1.5"] },
                { "id": "openai", "configured": false, "reachable": null, "error": "OPENAI_API_KEY is not set",
                  "embeddings": true, "models": [] }],
  "defaults": { "chat": { "provider": "lmstudio", "model": "qwen2.5-7b-instruct", "available": true },
                "embedding": { "provider": "lmstudio", "model": "text-embedding-nomic-embed-text-v1.5", "available": true } } }
```

`providers` always lists `lmstudio`, `openai`, `gemini` and `anthropic`; a hosted one is asked only when its key is set, and keys are never returned. `langflowKey` is `auto` (minted at start), `env` (`LANGFLOW_API_KEY`) or `none` (not yet). `/ready` does not ask the model providers, so a stopped LM Studio shows here but doesn't make the API unready.

## Workspaces

| Method | Path | Does |
|---|---|---|
| GET | `/v1/workspaces` | Workspaces the caller can see, each with `access`: `admin`, `editor` or `reader` |
| POST | `/v1/workspaces` | Create: `{ "slug": "personal", "name": "Personal", "description": "…", "settings": { … } }` |
| GET, PATCH, DELETE | `/v1/workspaces/{slug}` | Read, update name, description or settings; delete with all its data |
| POST | `/v1/workspaces/{slug}/reindex` | Admin. Empty the Chroma collection and re-run ingestion for every document, optionally with a new model: body `{ "embeddingProvider": "openai", "embeddingModel": "text-embedding-3-small" }`, or no body to keep the model (for example after changing chunking). Returns `202` with the workspace; it is `reindexing` until every document is `ready` or `failed`. `409` while a reindex runs, `422` for a provider whose key is not set, `400` for a provider without a model |
| GET | `/v1/workspaces/{slug}/members` | People with access and their role |
| PUT, DELETE | `/v1/workspaces/{slug}/members/{userId}` | Grant (`{ "role": "reader" | "editor" }`) or remove a person's access |

```json
{ "id": "ws_01J…", "slug": "ouc", "name": "OUC study material", "description": "COS512 and other modules",
  "status": "active",
  "settings": { "chatProvider": null, "chatModel": null,
                "embeddingProvider": "lmstudio", "embeddingModel": "text-embedding-nomic-embed-text-v1.5",
                "systemPrompt": null, "chunkSize": 800, "chunkOverlap": 100, "topK": 5, "minScore": null },
  "access": "admin",
  "stats": { "documents": 42, "passages": 5120, "conversations": 7 },   // (planned)
  "createdAt": "…", "updatedAt": "…" }
```

- `slug` is 3 to 40 characters, lowercase letters, digits and hyphens, and cannot be changed after creation (the collection and the upload folder are named after it). A taken slug returns `409`.
- `chatProvider` and `embeddingProvider` are one of the providers configured in `.env`: `lmstudio`, `openai`, `gemini`, `anthropic` (chat only) or a custom OpenAI-compatible one. `GET /v1/system` lists the providers and the models each offers; choosing one whose key is not set returns `422`. Provider keys are never accepted or returned by the API.
- `null` settings use the global defaults from `.env`. `embeddingProvider` and `embeddingModel` are the exception: they are filled in from the default when the workspace is created and are never `null` afterwards, so a later change to `.env` cannot silently break search in existing workspaces. `PATCH` refuses to change them (`400`); change them with workspace reindex, since vectors from two models can't be compared.
- `chunkSize` and `chunkOverlap` apply to documents ingested after the change; reindex applies them to everything.
- `status` is `active` or `reindexing`. While reindexing, passage search and reads, answers and chat messages return `503` with `Retry-After: 30`; the document list still works, so progress can be watched (each document goes `queued`, `processing`, `ready`).
- Deleting a workspace removes its collection, files, documents, conversations and answers, and unbinds it from API keys; a key left with no workspace is revoked. Usage rows are kept with the workspace marked deleted.

## Asking

| Method | Path | Does |
|---|---|---|
| POST | `/v1/workspaces/{slug}/answers` | Answer one question from the workspace's material |
| GET | `/v1/workspaces/{slug}/answers/{answerId}` | A stored answer |
| POST | `/v1/workspaces/{slug}/answers/{answerId}/feedback` | `{ "rating": "up" | "down", "comment": "…" }` |
| POST, GET | `/v1/workspaces/{slug}/conversations` | Start or list conversations |
| GET, DELETE | `/v1/workspaces/{slug}/conversations/{conversationId}` | A conversation with its messages; delete it with its messages |
| POST | `/v1/workspaces/{slug}/conversations/{conversationId}/messages` | Send a message, get the reply with citations |
| GET | `/v1/workspaces/{slug}/passages?query=…&limit=5&minScore=…` | Best matching passages with scores, no AI answer (`folderId` filter planned) |
| GET | `/v1/workspaces/{slug}/passages/{passageId}` | One passage with its neighbours |
| GET | `/v1/workspaces/{slug}/documents/{documentId}/passages` | A document's passages in order, paginated (used by the document detail screen) |

```json
// POST /v1/workspaces/ouc/answers
{ "question": "What is retrieval-augmented generation?", "maxPassages": 5 }
// 201
{ "id": "ans_01J…", "workspace": "ouc", "question": "…", "text": "Retrieval-augmented generation combines …",
  "status": "complete", "grounded": true,
  "citations": [ { "rank": 1, "passageId": "psg_01J…", "documentId": "doc_01J…", "documentTitle": "Week 3 slides",
                   "page": 12, "snippet": "RAG retrieves relevant passages …", "score": 0.83 } ],
  "provider": "lmstudio", "model": "qwen2.5-7b-instruct",
  "usage": { "promptTokens": 1840, "completionTokens": 212 },
  "latencyMs": 2310, "timeToFirstTokenMs": null, "error": null, "feedback": null, "createdAt": "…" }
```

- Citations are the passages that were given to the model, in rank order; `rank` is the `[n]` the text may cite. `folderId` and `startSeconds` join them with folders and audio *(planned)*.
- Every answer is stored, failures too (`status: "failed"` with `error`), so usage counts them; the caller still gets the error status.
- An answer, and a conversation, is visible only to the person or key that created it, and to admins; anyone else gets `404`.
- When nothing in the workspace scores above `minScore`, the answer is still `201` with `"grounded": false`, a fixed "not found in this workspace" text and empty citations; the chat model is not called.
- `usage` token counts can be `null` when the provider does not report them.
- Streaming adds `timeToFirstTokenMs`. A stream that fails midway ends with an `error` event and the answer is stored as failed, so it still shows in usage.
- The message body is `{ "content": "…" }` (`folderId` planned). A conversation's history sent to the model is capped (last 10 turns by default).

Messages use the same citation shape: `{ "id": "msg_…", "conversationId": "cnv_…", "role": "assistant", "content": "…", "citations": [...], "usage": {...} }`.

## Material

| Method | Path | Does |
|---|---|---|
| GET, POST | `/v1/workspaces/{slug}/folders` *(planned)* | List or create folders |
| PATCH, DELETE | `/v1/workspaces/{slug}/folders/{folderId}` *(planned)* | Rename or delete a folder (documents move to the root) |
| POST | `/v1/workspaces/{slug}/documents` | Upload (multipart, one or more `files` parts; `folderId` and `tags` planned). Returns `{ "data": [{ "document": {…}, "duplicate": false }] }`, one entry per file; a file already in the workspace returns the existing document with `duplicate: true` |
| GET | `/v1/workspaces/{slug}/documents?status=…&type=…` | List documents (`folderId` filter planned) |
| GET, PATCH, DELETE | `/v1/workspaces/{slug}/documents/{documentId}` | Read; move or retag *(PATCH planned)*; delete with its vectors (`409` while it is processing) |
| POST | `/v1/workspaces/{slug}/documents/{documentId}/reindex` | Delete its vectors and run the ingest flow again; `202`, or `409` while it is processing |
| GET | `/v1/workspaces/{slug}/documents/{documentId}/file` | Download the original |
| GET | `/v1/workspaces/{slug}/documents/{documentId}/transcript` *(planned)* | The timestamped transcript (video and audio only) |
| GET | `/v1/workspaces/{slug}/documents/events` | Live status changes (server-sent events); see below |

```json
{ "id": "doc_01J…", "workspace": "ouc", "title": "Week 3 slides",
  "fileName": "week3.pdf", "type": "pdf", "sizeBytes": 2483011, "sha256": "9f2c…",
  "status": "processing", "attempts": 1, "error": null, "passageCount": null,
  "tags": ["rag"], "createdAt": "…", "updatedAt": "…" }
```

`status`: `queued`, `transcribing` (video and audio only), `processing`, `ready`, `failed`. A failed document keeps its `error` text and can be retried with reindex. Uploads over the size limit return `413`, unsupported types `415`, empty files `400`; one bad file rejects the whole request. (`folderId` on documents is planned.)

The events stream (`text/event-stream`, read with `fetch` since `EventSource` can't send `Authorization`) sends:

| Event | Data | When |
|---|---|---|
| `snapshot` | `{ "data": [Document, …] }` | Once, on connect: the **unfinished** documents only (`queued`, `transcribing`, `processing`) |
| `document` | a `Document` | A new upload or a status change in this workspace |
| `removed` | `{ "id": "doc_01J…" }` | A document was deleted |

A document that finished or was deleted while a client was disconnected is not in the next snapshot, so a client that was following it fetches it with `GET …/documents/{documentId}` (`404` means it was deleted). Comments (`: keep-alive`) arrive every 15 seconds.

## Usage analytics

Same routes globally (admins) and per workspace:

| Method | Path | Does |
|---|---|---|
| GET | `…/usage/summary?from=…&to=…` | Requests, server errors (5xx), client errors (4xx), error rate, p50/p95 latency, questions, ungrounded answers, tokens, feedback up/down |
| GET | `…/usage/timeseries?interval=hour|day&groupBy=route|apiKey|user|workspace` | Requests and latency per interval |
| GET | `…/usage/top-questions` | Most asked questions |
| GET | `…/usage/top-documents` | Most cited documents |
| GET | `…/usage/requests?route=…&status=…&apiKeyId=…&userId=…` | Raw request log, paginated |

Global routes (`/v1/usage/…`) are admin only; per-workspace routes are for that workspace's editors and admins. `from` and `to` default to the last 7 days; `from` after `to` is `400`. Timeseries buckets are UTC. Every `/v1` request is logged after its response (route pattern, never the raw path; a caller who hangs up is logged as `499`).

Question text is kept for a configurable time (`USAGE_QUESTION_RETENTION_DAYS`, default 90); after that the row stays for counts and latency with the text removed.

## API keys and identity

| Method | Path | Does |
|---|---|---|
| GET, POST | `/v1/api-keys` | List keys (last used; request count planned); create one |
| GET, PATCH, DELETE | `/v1/api-keys/{keyId}` | Read; rename, change workspaces or expiry (the role can't change: `400`); revoke (the key stays listed with `revokedAt`) |
| GET | `/v1/me` | The signed-in user or the key, with roles and workspaces |
| GET | `/v1/users?search=…&limit=…&cursor=…` | People in Keycloak (id, username, name, email, admin or not, enabled), read-only, so an admin can grant access before someone's first login. Admins only; `503` when Keycloak can't be reached or the people list isn't set up |

```json
// GET /v1/users?search=ali → 200 (admin only). The id is the userId for workspace members.
{ "data": [{ "id": "5b0d1c5e-…", "username": "alice", "email": "alice@example.com", "name": "Alice Example",
  "isAdmin": false, "enabled": true }], "nextCursor": null }
```

```json
// POST /v1/api-keys → 201 (admin only)
{ "id": "key_01J…", "name": "Claude agent", "role": "reader", "workspaces": ["ouc"],
  "prefix": "rw_7Hk2", "secret": "rw_7Hk2…", "expiresAt": null, "createdAt": "…" }
```

`role`: `reader` (passages, answers, conversations) or `editor` (also documents and folders). Langflow does not use API keys: the API calls Langflow, never the other way round.

## Errors

| Status | When |
|---|---|
| 400, 422 | Malformed request; valid JSON that fails validation |
| 401 | Missing, expired or revoked token or key |
| 403 | Authenticated, in the workspace, but the role does not allow the action |
| 404 | No such resource, or a workspace the caller has no access to |
| 409 | Slug already taken; deleting or reindexing a document while it is processing; reindexing a workspace that is already reindexing; changing a revoked API key |
| 413, 415 | File too large; file type not supported |
| 429 | Rate limit |
| 502, 504 | Langflow failed (or the model returned an empty answer) or timed out |
| 503 | Langflow not ready yet (with `Retry-After`) or unreachable; a provider key missing; Keycloak unreachable; workspace reindexing |

## Mapping to the assignment brief

| Brief example | Our route | Why |
|---|---|---|
| `/ask` | `POST /v1/workspaces/{slug}/answers` | Answers are stored records, so they can be fetched, rated and counted |
| `/chat` | `POST /v1/workspaces/{slug}/conversations/{id}/messages` | A conversation is a resource with its own history and memory |
| `/retrieve` | `GET /v1/workspaces/{slug}/passages?query=…` | Retrieval is a read, so it is a GET |
| Analytics on API usage | `GET …/usage/*` | Every request logged with workspace, user or key |

No aliases with the brief's names are provided (decided).
