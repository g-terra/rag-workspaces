---
title: Choose a response style when asking through MCP
date: 2026-11-23
pr: "#111"
status: in review
areas: [mcp, docs]
---

# Choose a response style when asking through MCP

## Summary

The MCP server (`apps/mcp`) gains a `list_styles` tool and an optional `style` argument on `ask`. An agent can
list the response styles, built-in and custom, and ask for an answer in one of them. The `ask` result now
says which style the answer used.

## Why

The REST API takes a `style` on answers ([2026-11-23-response-styles.md](2026-11-23-response-styles.md),
[2026-11-23-custom-styles.md](2026-11-23-custom-styles.md)). Decision 13 makes the MCP server a thin client of
that API, so agents get what other callers get.

## Design

1. `list_styles` (`apps/mcp/src/tools.ts`) calls `GET /v1/styles` and returns `slug`, `name` and
   `description` for each style. It leaves out `instructions`, because the agent only needs to choose. It is
   read-only.
2. `ask` takes an optional `style` (a slug) and sends it to `POST /v1/workspaces/{slug}/answers`. It returns
   the answer's `style`. With no `style`, the workspace's default applies, as before; `null` asks for no style. An unknown slug comes
   back as a tool error with the API's `400` reason.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| A separate `list_styles` tool | List the slugs in `ask`'s description | Custom styles change at run time, and a tool description is fixed when the server starts. |
| `list_styles` leaves out `instructions` | Return everything | A shorter result costs the agent fewer tokens. The name and description are enough to choose. |
| `style` is a plain string | An enum of the built-ins | Custom slugs are valid too, and the API already validates the value. |

## Interfaces and contracts

- **HTTP API**: None. The server calls `GET /v1/styles` and sends `style` on answers.
- **Configuration**: None.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None. MCP tools: there is a new `list_styles` tool, `ask` takes `style`, and `ask`'s
  result has `style`.

## Operations

Rebuild the MCP server (`pnpm --filter '@rag/mcp...' build`) and restart the MCP client.

## Testing

- `apps/mcp/src/tools.test.ts`: covers the tool list, that `list_styles` calls `/v1/styles` and returns the
  short form, and that `ask` sends `style` and returns it.

## Out of scope and follow-ups

- Chat over MCP: the server has no chat tool.

## Docs updated

`docs/guide/api-keys.md` (the MCP tools table; the README no longer lists the tools).
