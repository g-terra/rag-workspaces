import { conversations, messages, newId, type Database } from '@rag/db';
import {
  Conversation,
  ConversationQuery,
  ConversationWithMessages,
  CreateConversation,
  Message,
  SendMessage,
  WorkspaceSlug,
  page,
} from '@rag/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireWorkspace } from '../auth/access.js';
import type { Principal } from '../auth/principal.js';
import { HttpProblem } from '../errors.js';
import {
  canSeeConversation,
  toApiConversation,
  toApiMessage,
  type ConversationService,
} from '../services/conversations.js';
import { assertSearchable, flowProblem } from '../services/flow-errors.js';
import { wantsEventStream } from '../sse.js';
import { messageUsage } from '../usage/details.js';
import { streamGeneration } from './streaming.js';

export type ConversationRoutesOptions = { db: Database; conversations: ConversationService };

const SlugParams = z.object({ slug: WorkspaceSlug });
const ConversationParams = SlugParams.extend({ conversationId: z.string() });
const common = { tags: ['conversations'], security: [{ bearerAuth: [] }] };

export const conversationRoutes: FastifyPluginAsyncZod<ConversationRoutesOptions> = async (app, opts) => {
  const { db, conversations: service } = opts;

  async function loadVisible(workspaceId: string, conversationId: string, caller: Principal) {
    const [row] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, conversationId)));
    if (!row || !canSeeConversation(row, caller)) {
      throw new HttpProblem(404, `No conversation ${conversationId}`);
    }
    return row;
  }

  app.post(
    '/v1/workspaces/:slug/conversations',
    {
      schema: {
        ...common,
        summary: 'Start a conversation',
        description: 'An empty conversation. Its title is taken from the first message unless given here.',
        params: SlugParams,
        body: CreateConversation,
        response: { 201: Conversation },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const [row] = await db
        .insert(conversations)
        .values({
          id: newId('conversation'),
          workspaceId: workspace.id,
          ownerKind: req.principal!.kind,
          ownerId: req.principal!.id,
          title: req.body.title ?? null,
        })
        .returning();
      return reply.status(201).send(toApiConversation(row!, workspace.slug));
    },
  );

  app.get(
    '/v1/workspaces/:slug/conversations',
    {
      schema: {
        ...common,
        summary: 'List your conversations',
        description: 'The caller’s own conversations in this workspace, most recently active first.',
        params: SlugParams,
        querystring: ConversationQuery,
        response: { 200: page(Conversation) },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const offset = Number(req.query.cursor ?? 0);
      const rows = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, workspace.id),
            eq(conversations.ownerKind, req.principal!.kind),
            eq(conversations.ownerId, req.principal!.id),
          ),
        )
        .orderBy(desc(conversations.updatedAt), desc(conversations.id))
        .limit(req.query.limit + 1)
        .offset(offset);
      const more = rows.length > req.query.limit;
      return {
        data: rows.slice(0, req.query.limit).map((c) => toApiConversation(c, workspace.slug)),
        nextCursor: more ? String(offset + req.query.limit) : null,
      };
    },
  );

  app.get(
    '/v1/workspaces/:slug/conversations/:conversationId',
    {
      schema: {
        ...common,
        summary: 'Get a conversation',
        description:
          'A conversation with all its messages, oldest first. Only its owner, and admins, can read it.',
        params: ConversationParams,
        response: { 200: ConversationWithMessages },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const conversation = await loadVisible(workspace.id, req.params.conversationId, req.principal!);
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(asc(messages.createdAt), asc(messages.id));
      return { ...toApiConversation(conversation, workspace.slug), messages: rows.map(toApiMessage) };
    },
  );

  app.delete(
    '/v1/workspaces/:slug/conversations/:conversationId',
    {
      schema: {
        ...common,
        summary: 'Delete a conversation',
        description: 'Deletes the conversation and its messages. This cannot be undone.',
        params: ConversationParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      const conversation = await loadVisible(workspace.id, req.params.conversationId, req.principal!);
      await db.delete(conversations).where(eq(conversations.id, conversation.id));
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/v1/workspaces/:slug/conversations/:conversationId/messages',
    {
      schema: {
        ...common,
        summary: 'Send a message',
        description:
          'Adds your message and returns the reply, with citations. The model sees the last turns of the ' +
          'conversation (`CHAT_HISTORY_TURNS`, 10 by default), and the search also uses your previous question, ' +
          'so follow-ups work. Streams like answers with `Accept: text/event-stream` ' +
          '(`token`, `citations`, `done`, or `error` with `messageId`).',
        params: ConversationParams,
        body: SendMessage,
        response: { 201: Message },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'reader');
      assertSearchable(workspace);
      const conversation = await loadVisible(workspace.id, req.params.conversationId, req.principal!);
      const input = { workspace, conversation, content: req.body.content, requestId: req.id };

      if (!wantsEventStream(req)) {
        const { reply: message, error } = await service.send(input);
        req.usage = messageUsage(message, input.content);
        if (error) throw flowProblem(error, 'Replying');
        return reply.status(201).send(toApiMessage(message));
      }
      return streamGeneration(req, reply, {
        what: 'Replying',
        idKey: 'messageId',
        run: async (hooks) => {
          const { reply: message, error } = await service.send({ ...input, ...hooks });
          req.usage = messageUsage(message, input.content);
          return { result: toApiMessage(message), error };
        },
      });
    },
  );
};
