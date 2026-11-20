# API schema

Resource-oriented REST API. Everything is under `/v1`; material-related resources live inside a workspace: `/v1/workspaces/{slug}/...`. The live, generated spec is at `/openapi.json` and Swagger UI at `/docs`.

## Conventions

| Convention | Rule |
|---|---|
| Versioning | `/v1`; breaking changes go to `/v2` |
| Auth | `Authorization: Bearer <token or key>`: a Keycloak access token (people) or an API key (agents, scripts, Langflow) |
| Isolation | A caller only sees workspaces it is granted; others return 404, not 403, so their existence is not revealed |
| Ids | Prefixed ULIDs: `ws_`, `fld_`, `doc_`, `ans_`, `cnv_`, `msg_`, `psg_`, `key_`, `usr_`. Workspaces are addressed by `slug` |
| Fields | JSON, camelCase, ISO 8601 UTC timestamps |
| Lists | `?limit=20&cursor=…` returns `{ "data": [...], "nextCursor": "…" | null }` |
| Errors | RFC 9457 problem JSON: `{ "type", "title", "status", "detail", "requestId" }` |
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
| API key | `/v1/api-keys` | admin |
| Me | `/v1/me` | anyone authenticated |

Outside `/v1`: `GET /health`, `GET /ready`, `GET /openapi.json`, `/docs`.

## Workspaces

| Method | Path | Does |
|---|---|---|
| GET | `/v1/workspaces` | Workspaces the caller can see |
| POST | `/v1/workspaces` | Create: `{ "slug": "personal", "name": "Personal", "description": "…", "settings": { … } }` |
| GET, PATCH, DELETE | `/v1/workspaces/{slug}` | Read, update name, description or settings; delete with all its data |
| POST | `/v1/workspaces/{slug}/reindex` | Re-run ingestion for every document (needed after changing the embedding model) |
| GET, PUT, DELETE | `/v1/workspaces/{slug}/members/{userId}` | Grant or remove a person's access (`member` or `editor`) |

```json
{ "id": "ws_01J…", "slug": "ouc", "name": "OUC study material", "description": "COS512 and other modules",
  "settings": { "chatModel": null, "embeddingModel": "text-embedding-nomic-embed-text-v1.5",
                "systemPrompt": null, "chunkSize": 800, "chunkOverlap": 100, "topK": 5 },
  "stats": { "documents": 42, "passages": 5120, "conversations": 7 },
  "createdAt": "…" }
```

`null` settings use the global defaults from `.env`. `embeddingModel` is locked while the workspace has documents, except through reindex.

## Asking

| Method | Path | Does |
|---|---|---|
| POST | `/v1/workspaces/{slug}/answers` | Answer one question from the workspace's material |
| GET | `/v1/workspaces/{slug}/answers/{answerId}` | A stored answer |
| POST | `/v1/workspaces/{slug}/answers/{answerId}/feedback` | `{ "rating": "up" | "down", "comment": "…" }` |
| POST, GET | `/v1/workspaces/{slug}/conversations` | Start or list conversations |
| GET, DELETE | `/v1/workspaces/{slug}/conversations/{conversationId}` | A conversation with its messages; delete it and its memory |
| POST | `/v1/workspaces/{slug}/conversations/{conversationId}/messages` | Send a message, get the reply with citations |
| GET | `/v1/workspaces/{slug}/passages?query=…&folderId=…&limit=5` | Best matching passages with scores, no AI answer |
| GET | `/v1/workspaces/{slug}/passages/{passageId}` | One passage with its neighbours |

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

Messages use the same citation shape: `{ "id": "msg_…", "conversationId": "cnv_…", "role": "assistant", "content": "…", "citations": [...], "usage": {...} }`.

## Material

| Method | Path | Does |
|---|---|---|
| GET, POST | `/v1/workspaces/{slug}/folders` | List or create folders |
| PATCH, DELETE | `/v1/workspaces/{slug}/folders/{folderId}` | Rename or delete a folder (documents move to the root) |
| POST | `/v1/workspaces/{slug}/documents` | Upload (multipart `files[]`, optional `folderId`, `tags[]`) |
| GET | `/v1/workspaces/{slug}/documents?folderId=…&status=…&type=…` | List documents |
| GET, PATCH, DELETE | `/v1/workspaces/{slug}/documents/{documentId}` | Read; move or retag; delete with its vectors |
| POST | `/v1/workspaces/{slug}/documents/{documentId}/reindex` | Delete its vectors and run the ingest flow again |
| GET | `/v1/workspaces/{slug}/documents/{documentId}/file` | Download the original |
| GET | `/v1/workspaces/{slug}/documents/events` | Live status changes (server-sent events) |

```json
{ "id": "doc_01J…", "workspace": "ouc", "folderId": "fld_01J…", "title": "Week 3 slides",
  "fileName": "week3.pdf", "type": "pdf", "sizeBytes": 2483011, "sha256": "9f2c…",
  "status": "processing", "attempts": 1, "error": null, "passageCount": null,
  "tags": ["rag"], "createdAt": "…", "updatedAt": "…" }
```

`status`: `queued`, `transcribing` (video and audio only), `processing`, `ready`, `failed`.

## Usage analytics

Same routes globally (admins) and per workspace:

| Method | Path | Does |
|---|---|---|
| GET | `…/usage/summary?from=…&to=…` | Requests, error rate, p50/p95 latency, tokens, feedback up/down |
| GET | `…/usage/timeseries?interval=hour|day&groupBy=route|apiKey|user|workspace` | Requests and latency per interval |
| GET | `…/usage/top-questions` | Most asked questions |
| GET | `…/usage/top-documents` | Most cited documents |
| GET | `…/usage/requests?route=…&status=…&apiKeyId=…&userId=…` | Raw request log, paginated |

## API keys and identity

| Method | Path | Does |
|---|---|---|
| GET, POST | `/v1/api-keys` | List keys (last used, request count); create one |
| PATCH, DELETE | `/v1/api-keys/{keyId}` | Rename, change workspaces or expiry; revoke |
| GET | `/v1/me` | The signed-in user or the key, with roles and workspaces |

```json
// POST /v1/api-keys → 201 (admin only)
{ "id": "key_01J…", "name": "Claude agent", "role": "reader", "workspaces": ["ouc"],
  "purpose": "general", "prefix": "rw_7Hk2", "secret": "rw_7Hk2…", "expiresAt": null, "createdAt": "…" }
```

`role`: `reader` (passages, answers, conversations) or `editor` (also documents and folders). `purpose`: `general` or `langflow`; a Langflow key's create screen shows how to store it as a Langflow global variable and call the API from a flow.

## Mapping to the assignment brief

| Brief example | Our route | Why |
|---|---|---|
| `/ask` | `POST /v1/workspaces/{slug}/answers` | Answers are stored records, so they can be fetched, rated and counted |
| `/chat` | `POST /v1/workspaces/{slug}/conversations/{id}/messages` | A conversation is a resource with its own history and memory |
| `/retrieve` | `GET /v1/workspaces/{slug}/passages?query=…` | Retrieval is a read, so it is a GET |
| Analytics on API usage | `GET …/usage/*` | Every request logged with workspace, user or key |

No aliases with the brief's names are provided (decided).
