import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  Answer,
  Document,
  Folder,
  PassageSearchResult,
  PassageWithNeighbours,
  StyleList,
  Workspace,
} from '@rag/shared';
import { z } from 'zod';
import { ApiError, type RagApi } from './api.js';

type Page<T> = { data: T[]; nextCursor: string | null };

const workspace = z.string().describe('Workspace slug, as list_workspaces gives it, e.g. "ouc".');
const folderId = z
  .string()
  .optional()
  .describe(
    'Only use documents in this folder (an id from list_folders). Leave out for the whole workspace.',
  );

/** JSON for the agent; an API error becomes a tool error with the API's reason, not a crash. */
async function reply(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await run(), null, 2) }] };
  } catch (err) {
    const text = err instanceof ApiError ? err.message : `Could not reach rag-workspaces: ${String(err)}`;
    return { isError: true, content: [{ type: 'text', text }] };
  }
}

const slugPath = (slug: string) => `/v1/workspaces/${encodeURIComponent(slug)}`;

/**
 * Tools over the REST API that change no material, so an `rw_` key with the `reader` role is enough. Each
 * tool returns what the agent needs to cite: passage ids, document titles, and pages or start times.
 */
export function createServer(api: RagApi, version: string): McpServer {
  const server = new McpServer({ name: 'rag-workspaces', version });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description: 'The workspaces this API key can read. Every other tool takes one of their slugs.',
      annotations: readOnly,
    },
    () =>
      reply(async () => {
        const { data } = await api.get<Page<Workspace>>('/v1/workspaces');
        return data.map((w) => ({
          slug: w.slug,
          name: w.name,
          description: w.description,
          status: w.status,
        }));
      }),
  );

  server.registerTool(
    'list_folders',
    {
      title: 'List folders',
      description: 'Folders in a workspace (for example one per course), with how many documents each holds.',
      inputSchema: { workspace },
      annotations: readOnly,
    },
    ({ workspace: slug }) =>
      reply(async () => {
        const { data } = await api.get<Page<Folder>>(`${slugPath(slug)}/folders`);
        return data.map((f) => ({ id: f.id, name: f.name, documentCount: f.documentCount }));
      }),
  );

  server.registerTool(
    'list_documents',
    {
      title: 'List documents',
      description: 'The material in a workspace: title, file name, type, ingestion status and folder.',
      inputSchema: { workspace, folderId },
      annotations: readOnly,
    },
    ({ workspace: slug, folderId: folder }) =>
      reply(async () => {
        const { data } = await api.get<Page<Document>>(`${slugPath(slug)}/documents`, { folderId: folder });
        return data.map((d) => ({
          id: d.id,
          title: d.title,
          fileName: d.fileName,
          type: d.type,
          status: d.status,
          folderId: d.folderId,
          passageCount: d.passageCount,
        }));
      }),
  );

  server.registerTool(
    'search_passages',
    {
      title: 'Search passages',
      description:
        'The passages that best match a query, best first, with a similarity score (0 to 1), document ' +
        'title and page. No AI answer: use it to find and quote the material yourself.',
      inputSchema: {
        workspace,
        query: z.string().min(1).describe('What to look for, in plain words.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('How many passages (default: the workspace setting).'),
        folderId,
      },
      annotations: readOnly,
    },
    ({ workspace: slug, query, limit, folderId: folder }) =>
      reply(async () => {
        const { data } = await api.get<PassageSearchResult>(`${slugPath(slug)}/passages`, {
          query,
          limit,
          folderId: folder,
        });
        return data;
      }),
  );

  server.registerTool(
    'read_passage',
    {
      title: 'Read a passage',
      description:
        'One passage by id (from search_passages or a citation), with the passages just before and after it.',
      inputSchema: { workspace, passageId: z.string().describe('A passage id, "psg_…".') },
      annotations: readOnly,
    },
    ({ workspace: slug, passageId }) =>
      reply(() =>
        api.get<PassageWithNeighbours>(`${slugPath(slug)}/passages/${encodeURIComponent(passageId)}`),
      ),
  );

  server.registerTool(
    'list_styles',
    {
      title: 'List response styles',
      description:
        'Styles an answer can be written in (tone, length, format), for the `style` argument of ask. ' +
        'They never change what an answer may say: it still cites the material and refuses what it does not cover.',
      annotations: readOnly,
    },
    () =>
      reply(async () => {
        const { data } = await api.get<StyleList>('/v1/styles');
        return data.map((s) => ({ slug: s.slug, name: s.name, description: s.description }));
      }),
  );

  server.registerTool(
    'ask',
    {
      title: 'Ask the workspace',
      description:
        "An answer written by the workspace's model from its own material, with numbered citations. " +
        '`grounded: false` means the material does not answer it: nothing was relevant enough, or the model cited none of the passages it read.',
      inputSchema: {
        workspace,
        question: z.string().min(1).describe('The question, in plain words.'),
        folderId,
        style: z
          .string()
          .optional()
          .describe(
            "A response style slug from list_styles, e.g. \"concise\". Leave out for the workspace's default.",
          ),
      },
      // It runs a model and stores the answer, but changes no material.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ workspace: slug, question, folderId: folder, style }) =>
      reply(async () => {
        const a = await api.post<Answer>(`${slugPath(slug)}/answers`, { question, folderId: folder, style });
        return {
          answerId: a.id,
          grounded: a.grounded,
          text: a.text,
          citations: a.citations.map((c) => ({
            rank: c.rank,
            passageId: c.passageId,
            documentTitle: c.documentTitle,
            page: c.page,
            startSeconds: c.startSeconds,
            snippet: c.snippet,
          })),
          model: a.model,
          style: a.style,
        };
      }),
  );

  return server;
}
