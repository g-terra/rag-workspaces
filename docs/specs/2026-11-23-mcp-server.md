---
title: MCP server for agents
date: 2026-11-23
pr: "#51"
status: merged
areas: [mcp, docs]
---

# MCP server for agents

## Summary

`apps/mcp` is a new package, `@rag/mcp`: an [MCP](https://modelcontextprotocol.io) server that an agent's
client (Claude Desktop, Claude Code, any MCP client) starts over stdio. It turns six tools into calls to the
REST API with an `rw_` API key:

| Tool | API call |
| ---- | -------- |
| `list_workspaces` | `GET /v1/workspaces` |
| `list_folders` | `GET /v1/workspaces/{slug}/folders` |
| `list_documents` | `GET /v1/workspaces/{slug}/documents?folderId=` |
| `search_passages` | `GET /v1/workspaces/{slug}/passages?query=&limit=&folderId=` |
| `read_passage` | `GET /v1/workspaces/{slug}/passages/{id}` |
| `ask` | `POST /v1/workspaces/{slug}/answers { question, folderId? }` |

Nothing in the API changed.

## Why

Decision 13 left an MCP server for later (docs/work-breakdown.md, "Later"). Guilherme asked on 2026-11-23
for every planned feature, so it is built now, and decision 13 now records how. Agents could already use the
REST API through its OpenAPI spec, but an MCP client needs tools, and these six are what an agent needs to
find material and cite it.

## Design

1. **`apps/mcp/src/api.ts`**, `RagApi`: `get(path, query)` and `post(path, body)` with
   `Authorization: Bearer <key>`. A non-2xx answer becomes an `ApiError` carrying the problem's `detail`, plus
   "(retry after N s)" when the API sent `Retry-After`. Requests time out after 200 s, since a local model
   can be slow to answer.
2. **`apps/mcp/src/tools.ts`**, `createServer(api, version)`: registers the tools with zod input schemas
   (`@modelcontextprotocol/sdk` 1.32.2, `McpServer.registerTool`). Each tool returns JSON text with only the
   fields an agent needs (ids, titles, pages, scores, citations). An `ApiError` becomes a tool result with
   `isError: true` and the API's reason, so the agent can correct itself (for example a wrong workspace slug)
   instead of the call failing.
3. **`apps/mcp/src/main.ts`**: the `rag-workspaces-mcp` binary. It reads `RW_API_KEY` (required: without it
   the server writes a message to stderr and exits with 1) and `RW_API_URL` (default
   `http://localhost:3000`), and serves over `StdioServerTransport`. stdout belongs to the protocol, so
   nothing else writes there.
4. **Annotations**: every tool but `ask` has `readOnlyHint: true`. `ask` runs the model and stores an answer,
   but changes no material (`destructiveHint: false`).

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A client of the REST API, run on the agent's machine | A `/mcp` route inside the API (streamable HTTP) | No new service, port or auth path. Roles, workspace isolation, rate limits and the usage log apply exactly as for any other caller with that key |
| stdio only | Also streamable HTTP | Claude Desktop and Claude Code start local servers over stdio. HTTP can be added if a remote agent needs it |
| Search, read and ask; no upload, chat or admin tools | Every route as a tool | An agent needs to find and cite material. Writes are better done by people in the admin UI, and a `reader` key is then enough |
| `ask`, not conversations | A `chat` tool | The agent keeps its own conversation; a one-off answer with citations is what it needs from the workspace |
| Its own small fetch wrapper | The admin UI's generated client | That client is tied to the browser build and oidc tokens; five calls don't need it |
| Not in the compose stack or an image | A container | It runs where the agent runs, started by the agent's client |

## Interfaces and contracts

- **HTTP API**: None changed. The server calls the six routes listed in the summary.
- **MCP**: server name `rag-workspaces`, version from `apps/mcp/package.json`. Tools and their inputs:
  - `list_workspaces {}`.
  - `list_folders { workspace }`.
  - `list_documents { workspace, folderId? }`.
  - `search_passages { workspace, query, limit? (1–50), folderId? }`.
  - `read_passage { workspace, passageId }`.
  - `ask { workspace, question, folderId? }`. It returns `{ answerId, grounded, text, citations[{ rank,
    passageId, documentTitle, page, snippet }], model }`.
- **Configuration**: `RW_API_KEY` (required) and `RW_API_URL` (default `http://localhost:3000`), set in the
  MCP client's config, not in `.env`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: tool calls reach the API as ordinary requests with the key, so they appear in the
  usage log under that key.

## Operations

Nothing changes for an existing install. To use it: create a `reader` key in the admin UI, run
`pnpm --filter '@rag/mcp...' build`, and add the server to the MCP client (README, "Connect an agent").

## Testing

- `apps/mcp/src/tools.test.ts` connects a real MCP `Client` to the server through `InMemoryTransport`, with a
  fake `fetch`:
  - The six tools are listed, and only `ask` isn't read-only.
  - `search_passages` sends the key, query, limit and folder; a folder left out isn't sent.
  - A `429` problem becomes a tool error: "HTTP 429: Too many searches. (retry after 12 s)".
  - `ask` posts the question and folder and returns the trimmed answer and citations.
  - A network failure becomes a tool error.
- By hand, against the smoke stack: the built `dist/main.js`, started over stdio by the SDK's
  `StdioClientTransport` with a fresh `reader` key, listed workspaces and folders, found the uploaded
  passage, answered with a citation, and gave `HTTP 404: No workspace "nope"` for a wrong slug.

## Out of scope and follow-ups

- Streamable HTTP transport, for remote agents.
- Write tools (upload, move to a folder) and a chat tool.
- Publishing the package to npm, so `npx` can start it without a clone.

## Docs updated

- `README.md`: "Connect an agent (MCP)" and the `apps/mcp` row.
- `docs/decisions.md`: decision 13.
- `docs/work-breakdown.md`: the "Later" row.
- `docs/architecture.md`: status table and repository layout.
- `docs/specs/TEMPLATE.md`: `mcp` added to the areas.
