# API schema

Resource-oriented REST API. Everything is under `/v1`; material-related resources live inside a workspace: `/v1/workspaces/{slug}/...`. The live, generated spec is at `/openapi.json` and Swagger UI at `/docs`.

## Conventions

| Convention | Rule |
|---|---|
| Versioning | `/v1`; breaking changes go to `/v2` |
| Auth | `Authorization: Bearer <token or key>`: a Keycloak access token (people) or an API key (agents, scripts, Langflow) |
| Isolation | A caller only sees workspaces it is granted; others return 404, not 403, so their existence is not revealed |
| Ids | Prefixed ULIDs: `ws_`, `fld_`, `doc_`, `ans_`, `cnv_`, `msg_`, `key_`. Passages are `psg_<document ulid>_<chunk index>`, so they are stable across re-indexing with the same settings. Users are identified by their Keycloak user id. Workspaces are addressed by `slug` |
| Fields | JSON, camelCase, ISO 8601 UTC timestamps |
| Lists | `?limit=20&cursor=…` returns `{ "data": [...], "nextCursor": "…" | null }` |
| Errors | RFC 9457 problem JSON: `{ "type", "title", "status", "detail", "requestId" }`; validation errors add `errors: [{ "path", "message" }]`. See [errors](#errors) |
| Roles | One global role, `admin`. Inside a workspace, people and keys are `reader` or `editor` |
| Rate limits | Per key and per user; `429` with `Retry-After` and `RateLimit-*` headers |
| Streaming | `Accept: text/event-stream` on answers and messages streams `token`, `citations`, `done`, `error` events |
| Tracing | Every response has `X-Request-Id`, also stored in the usage log |

## Resources

| Resource | Path | Who |
|---|---|---|
| Workspace | `/v1/workspaces` | admin creates; members and keys see their own |
| Folder | `/v1/workspaces/{slug}/folders` | editor |
| Document | `/v1/workspaces/{slug}/documents` | editor to change, reader to list |
| Passage | `/v1/workspaces/{slug}/passages` | reader |
| Answer (+ feedback) | `/v1/workspaces/{slug}/answers` | reader |
| Conversation (+ messages) | `/v1/workspaces/{slug}/conversations` | reader |
| Usage | `/v1/usage`, `/v1/workspaces/{slug}/usage` | admin (global), editor (own workspace) |
| User | `/v1/users` | admin |
| System | `/v1/system` | admin |
| API key | `/v1/api-keys` | admin |
| Me | `/v1/me` | anyone authenticated |

Outside `/v1`: `GET /health`, `GET /ready` (ok or not, no detail), `GET /openapi.json`, `/docs`. `GET /v1/system` gives admins the detail behind `/ready`: the state of Postgres, Chroma, Langflow, Keycloak and the model provider, including whether the configured models are available.

## Workspaces

| Method | Path | Does |
|---|---|---|
| GET | `/v1/workspaces` | Workspaces the caller can see |
| POST | `/v1/workspaces` | Create: `{ "slug": "personal", "name": "Personal", "description": "…", "settings": { … } }` |
| GET, PATCH, DELETE | `/v1/workspaces/{slug}` | Read, update name, description or settings; delete with all its data |
| POST | `/v1/workspaces/{slug}/reindex` | Re-run ingestion for every document (needed after changing the embedding model or chunking). Returns `202`; the workspace is `reindexing` until every document is `ready` or `failed` |
| GET | `/v1/workspaces/{slug}/members` | People with access and their role |
| PUT, DELETE | `/v1/workspaces/{slug}/members/{userId}` | Grant (`{ "role": "reader" | "editor" }`) or remove a person's access |

```json
{ "id": "ws_01J…", "slug": "ouc", "name": "OUC study material", "description": "COS512 and other modules",
  "status": "active",
  "settings": { "chatModel": null, "embeddingModel": "text-embedding-nomic-embed-text-v1.5",
                "systemPrompt": null, "chunkSize": 800, "chunkOverlap": 100, "topK": 5, "minScore": null },
  "stats": { "documents": 42, "passages": 5120, "conversations": 7 },
  "createdAt": "…" }
```

- `slug` is 3 to 40 characters, lowercase letters, digits and hyphens, and cannot be changed after creation (the collection and the upload folder are named after it). A taken slug returns `409`.
- `null` settings use the global defaults from `.env`. `embeddingModel` is the exception: it is filled in from the default when the workspace is created and never `null` afterwards, so a later change to `.env` cannot silently break search in existing workspaces. It is locked while the workspace has documents, except through reindex.
- `chunkSize` and `chunkOverlap` apply to documents ingested after the change; reindex applies them to everything.
- `status` is `active` or `reindexing`. While reindexing, passages, answers and messages return `503` with `Retry-After`.
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
| GET | `/v1/workspaces/{slug}/passages?query=…&folderId=…&limit=5` | Best matching passages with scores, no AI answer |
| GET | `/v1/workspaces/{slug}/passages/{passageId}` | One passage with its neighbours |
| GET | `/v1/workspaces/{slug}/documents/{documentId}/passages` | A document's passages in order, paginated (used by the document detail screen) |

```json
// POST /v1/workspaces/ouc/answers
{ "question": "What is retrieval-augmented generation?", "folderId": "fld_01J…", "maxPassages": 5 }
// 201
{ "id": "ans_01J…", "workspace": "ouc", "question": "…", "text": "Retrieval-augmented generation combines …",
  "citations": [ { "passageId": "psg_01J…", "documentId": "doc_01J…", "documentTitle": "Week 3 slides",
                   "folderId": "fld_01J…", "page": 12, "startSeconds": null,
                   "snippet": "RAG retrieves relevant passages …", "score": 0.83 } ],
  "model": "qwen2.5-7b-instruct", "usage": { "promptTokens": 1840, "completionTokens": 212 },
  "latencyMs": 2310, "createdAt": "…" }
```

- Citations are the passages that were given to the model, in rank order.
- When nothing in the workspace scores above `minScore`, the answer is still `201` with `"grounded": false`, a fixed "not found in this workspace" text and empty citations; the chat model is not called.
- `usage` token counts can be `null` when the provider does not report them.
- Streaming adds `timeToFirstTokenMs`. A stream that fails midway ends with an `error` event and the answer is stored as failed, so it still shows in usage.
- The message body is `{ "content": "…", "folderId": "fld_…" }`. A conversation's history sent to the model is capped (last 10 turns by default).

Messages use the same citation shape: `{ "id": "msg_…", "conversationId": "cnv_…", "role": "assistant", "content": "…", "citations": [...], "usage": {...} }`.

## Material

| Method | Path | Does |
|---|---|---|
| GET, POST | `/v1/workspaces/{slug}/folders` | List or create folders |
| PATCH, DELETE | `/v1/workspaces/{slug}/folders/{folderId}` | Rename or delete a folder (documents move to the root) |
| POST | `/v1/workspaces/{slug}/documents` | Upload (multipart `files[]`, optional `folderId`, `tags[]`). Returns `{ "data": [{ "document": {…}, "duplicate": false }] }`, one entry per file; a file already in the workspace returns the existing document with `duplicate: true` |
| GET | `/v1/workspaces/{slug}/documents?folderId=…&status=…&type=…` | List documents |
| GET, PATCH, DELETE | `/v1/workspaces/{slug}/documents/{documentId}` | Read; move or retag; delete with its vectors |
| POST | `/v1/workspaces/{slug}/documents/{documentId}/reindex` | Delete its vectors and run the ingest flow again |
| GET | `/v1/workspaces/{slug}/documents/{documentId}/file` | Download the original |
| GET | `/v1/workspaces/{slug}/documents/{documentId}/transcript` | The timestamped transcript (video and audio only) |
| GET | `/v1/workspaces/{slug}/documents/events` | Live status changes (server-sent events); on connect it sends the current state of every unfinished document, so a reconnect misses nothing |

```json
{ "id": "doc_01J…", "workspace": "ouc", "folderId": "fld_01J…", "title": "Week 3 slides",
  "fileName": "week3.pdf", "type": "pdf", "sizeBytes": 2483011, "sha256": "9f2c…",
  "status": "processing", "attempts": 1, "error": null, "passageCount": null,
  "tags": ["rag"], "createdAt": "…", "updatedAt": "…" }
```

`status`: `queued`, `transcribing` (video and audio only), `processing`, `ready`, `failed`. A failed document keeps its `error` text and can be retried with reindex. Uploads over the size limit return `413`, unsupported types `415`.

## Usage analytics

Same routes globally (admins) and per workspace:

| Method | Path | Does |
|---|---|---|
| GET | `…/usage/summary?from=…&to=…` | Requests, error rate, p50/p95 latency, tokens, feedback up/down |
| GET | `…/usage/timeseries?interval=hour|day&groupBy=route|apiKey|user|workspace` | Requests and latency per interval |
| GET | `…/usage/top-questions` | Most asked questions |
| GET | `…/usage/top-documents` | Most cited documents |
| GET | `…/usage/requests?route=…&status=…&apiKeyId=…&userId=…` | Raw request log, paginated |

Question text is kept for a configurable time (default 90 days); after that the row stays for counts and latency with the text removed.

## API keys and identity

| Method | Path | Does |
|---|---|---|
| GET, POST | `/v1/api-keys` | List keys (last used, request count); create one |
| PATCH, DELETE | `/v1/api-keys/{keyId}` | Rename, change workspaces or expiry; revoke |
| GET | `/v1/me` | The signed-in user or the key, with roles and workspaces |
| GET | `/v1/users` | People known to Keycloak (id, name, email, admin or not), read-only, so an admin can grant access before someone's first login |

```json
// POST /v1/api-keys → 201 (admin only)
{ "id": "key_01J…", "name": "Claude agent", "role": "reader", "workspaces": ["ouc"],
  "purpose": "general", "prefix": "rw_7Hk2", "secret": "rw_7Hk2…", "expiresAt": null, "createdAt": "…" }
```

`role`: `reader` (passages, answers, conversations) or `editor` (also documents and folders). `purpose`: `general` or `langflow`; a Langflow key's create screen shows how to store it as a Langflow global variable and call the API from a flow.

## Errors

| Status | When |
|---|---|
| 400, 422 | Malformed request; valid JSON that fails validation |
| 401 | Missing, expired or revoked token or key |
| 403 | Authenticated, in the workspace, but the role does not allow the action |
| 404 | No such resource, or a workspace the caller has no access to |
| 409 | Slug already taken; embedding model change on a workspace that has documents |
| 413, 415 | File too large; file type not supported |
| 429 | Rate limit |
| 502, 504 | Langflow failed or timed out |
| 503 | Model provider unreachable or model not loaded; workspace reindexing |

## Mapping to the assignment brief

| Brief example | Our route | Why |
|---|---|---|
| `/ask` | `POST /v1/workspaces/{slug}/answers` | Answers are stored records, so they can be fetched, rated and counted |
| `/chat` | `POST /v1/workspaces/{slug}/conversations/{id}/messages` | A conversation is a resource with its own history and memory |
| `/retrieve` | `GET /v1/workspaces/{slug}/passages?query=…` | Retrieval is a read, so it is a GET |
| Analytics on API usage | `GET …/usage/*` | Every request logged with workspace, user or key |

No aliases with the brief's names are provided (decided).
