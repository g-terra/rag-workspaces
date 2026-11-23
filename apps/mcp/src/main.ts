#!/usr/bin/env node
// The rag-workspaces MCP server, over stdio. An MCP client (Claude Desktop, Claude Code, an
// agent framework) starts it with two environment variables:
//   RW_API_URL  the API, e.g. http://localhost:3000 (default)
//   RW_API_KEY  an rw_ API key made by an admin; its role and workspaces decide what it sees
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RagApi } from './api.js';
import { createServer } from './tools.js';

const apiKey = process.env.RW_API_KEY;
if (!apiKey) {
  // stdout belongs to the protocol; messages for people go to stderr.
  process.stderr.write(
    'Set RW_API_KEY to an rw_ API key (an admin creates one in the admin UI, "API keys").\n',
  );
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
const api = new RagApi({ baseUrl: process.env.RW_API_URL ?? 'http://localhost:3000', apiKey });
await createServer(api, version).connect(new StdioServerTransport());
