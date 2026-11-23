# Using the API

A guide with examples. For every route and field, see [api-schema.md](api-schema.md), or the live
Swagger UI at http://api.rag.localhost/docs (spec at `/openapi.json`).

## Authentication

Every `/v1` request sends `Authorization: Bearer <token or key>`:

- **People** sign in through Keycloak; the admin UI does this for them and sends their access token.
- **Agents and scripts** use an API key (`rw_…`), which an admin creates ([setup.md](setup.md), step 4).
  A key has one role, `reader` or `editor`, and a list of workspaces. Any other workspace is `404` for it,
  as if it didn't exist.

The examples use these shell variables:

```bash
export RW=http://api.rag.localhost   # or http://localhost:3000
export KEY=rw_...                    # a key for the workspace "ouc"
```

`GET /v1/me` shows who the key is and what it can reach:

```bash
curl -s "$RW/v1/me" -H "Authorization: Bearer $KEY"
```

## Add material (editor)

Upload one or more files as multipart `files` parts, optionally into a folder:

```bash
curl -s "$RW/v1/workspaces/ouc/documents" -H "Authorization: Bearer $KEY" \
  -F files=@week3.pdf -F files=@notes.md
```

Each file comes back as `{ document, duplicate }`. A file already in the workspace returns the existing
document with `duplicate: true` and isn't ingested again. Ingestion runs in the background. Poll
`GET …/documents/{id}` until `status` is `ready` (or `failed`, with `error`), or follow
`GET …/documents/events`, a server-sent event stream.

Folders group documents (for example one per course): `POST …/folders { "name": "COS512" }`, then
upload with `?folderId=fld_…` or move a document with `PATCH …/documents/{id} { "folderId": "fld_…" }`.

## Search, ask and chat (reader)

**Search** returns the best matching passages with a score from 0 to 1, without an AI answer:

```bash
curl -s -G "$RW/v1/workspaces/ouc/passages" -H "Authorization: Bearer $KEY" \
  --data-urlencode "query=what is retrieval-augmented generation" -d limit=3
```

**Ask** gets an answer written from the workspace's material, with numbered citations:

```bash
curl -s "$RW/v1/workspaces/ouc/answers" -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{ "question": "What is retrieval-augmented generation?" }'
```

The answer's `text` cites passages as `[1]`, `[2]`, matching `citations[].rank`, and each citation names its
document and page. When nothing in the workspace is relevant enough, the answer is `grounded: false` with a
fixed "not found" text, and no model is called. A reply that cites none of its passages (the model read them and
found nothing to use) is `grounded: false` too, with the model's own words. Rate an answer with
`POST …/answers/{id}/feedback { "rating": "up" }`.

**Stream** the answer as it is written by sending `Accept: text/event-stream`. The stream sends `token`
events (`{ "text" }`), then `citations`, then `done` with the stored answer:

```bash
curl -N "$RW/v1/workspaces/ouc/answers" -H "Authorization: Bearer $KEY" \
  -H 'accept: text/event-stream' -H 'content-type: application/json' \
  -d '{ "question": "Summarise week 3" }'
```

**Chat** keeps a conversation, so follow-up questions can refer to earlier ones:

```bash
CNV=$(curl -s "$RW/v1/workspaces/ouc/conversations" -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
curl -s "$RW/v1/workspaces/ouc/conversations/$CNV/messages" -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{ "content": "What is RAG?" }'
curl -s "$RW/v1/workspaces/ouc/conversations/$CNV/messages" -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{ "content": "And what are its weaknesses?" }'
```

Search, ask and chat messages all take an optional `folderId` to use only that folder's documents. Ask and chat
messages also take an optional `style`, a response style from `GET /v1/styles` such as `academic` or `concise`.
Answers and conversations are private: only the key or person that created them, and admins, can read them.

## From code

The same ask from TypeScript or JavaScript (Node 22, no libraries):

```ts
const res = await fetch(`${process.env.RW}/v1/workspaces/ouc/answers`, {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ question: 'What is retrieval-augmented generation?' }),
});
if (!res.ok) throw new Error((await res.json()).detail);
const answer = await res.json();
console.log(answer.text);
for (const c of answer.citations) console.log(`[${c.rank}] ${c.documentTitle}, page ${c.page ?? '-'}`);
```

Agents in Claude Desktop, Claude Code or another MCP client can use the MCP server instead
([API keys and agents](guide/api-keys.md#connect-an-ai-agent-mcp)).

## Errors and limits

Errors are problem JSON (RFC 9457): `{ "type", "title", "status", "detail", "requestId" }`. `detail` is
written to be shown to a person. The main ones:

| Status | Means |
|---|---|
| `401` | No key, or a revoked or expired one |
| `403` | The key's role doesn't allow this (for example a `reader` uploading) |
| `404` | No such resource, or a workspace the key can't reach |
| `409` | A conflict, such as changing a document while it is being ingested |
| `429` | Over a rate limit; wait `Retry-After` seconds |
| `502`, `504` | The model or Langflow failed or timed out |
| `503` | Not ready yet, or the workspace is reindexing; `Retry-After` when it is worth retrying |

Each person and key may make 600 requests a minute, of which 30 may run a model (search, answers and
chat messages). Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`.
Every response also has `X-Request-Id`; quote it when reporting a problem, since the same id is in the API's
logs and in the usage log.

## Usage analytics

Editors see their workspace's usage, admins everything:

```bash
curl -s "$RW/v1/workspaces/ouc/usage/summary" -H "Authorization: Bearer $KEY"
```

`…/usage/timeseries`, `…/top-questions`, `…/top-documents` and `…/requests` break it down further; see
[api-schema.md](api-schema.md#usage-analytics).
