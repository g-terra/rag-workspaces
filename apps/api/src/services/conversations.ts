import {
  conversations,
  messages,
  newId,
  type Conversation as ConversationRow,
  type Database,
  type Message as MessageRow,
  type Workspace,
} from '@rag/db';
import type { LangflowClient } from '@rag/langflow-client';
import type { Conversation, Message } from '@rag/shared';
import { desc, eq } from 'drizzle-orm';
import type { Principal } from '../auth/principal.js';
import type { Config } from '../config.js';
import { Generator, withStartSeconds, type GenerateConfig } from './generate.js';

/** Each earlier message is cut to this many characters in the history the model sees. */
const HISTORY_MESSAGE_CHARS = 2000;
const TITLE_CHARS = 80;

type SendInput = {
  workspace: Workspace;
  conversation: ConversationRow;
  content: string;
  folderId?: string;
  requestId?: string;
  onToken?: (text: string) => void;
  signal?: AbortSignal;
};

/** The stored reply, plus the error that made it fail. */
type SendResult = { reply: MessageRow; error?: unknown };

/**
 * Conversations with history. The `rw-chat` flow is stateless: each message sends it the
 * last turns from the `messages` table, so history lives in one place and deleting a
 * conversation is one delete.
 */
export class ConversationService {
  private readonly generator: Generator;

  constructor(
    private readonly deps: {
      db: Database;
      langflow: LangflowClient;
      config: GenerateConfig & Pick<Config, 'CHAT_HISTORY_TURNS'>;
    },
  ) {
    this.generator = new Generator(deps);
  }

  async send(input: SendInput): Promise<SendResult> {
    const { db, config } = this.deps;
    const { workspace, conversation, content, requestId } = input;

    // The last turns, oldest first; failed replies are left out.
    const earlier = config.CHAT_HISTORY_TURNS
      ? (
          await db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, conversation.id))
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .limit(config.CHAT_HISTORY_TURNS * 2)
        )
          .reverse()
          .filter((m) => m.content !== null)
      : [];

    await db.insert(messages).values({
      id: newId('message'),
      conversationId: conversation.id,
      role: 'user',
      content,
      requestId: requestId ?? null,
    });

    const history = earlier
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${clip(m.content!, HISTORY_MESSAGE_CHARS)}`)
      .join('\n');
    // Search with the previous question too, so a follow-up ("and in week 4?") finds passages.
    const previousQuestion = earlier.findLast((m) => m.role === 'user')?.content;
    const { failure, ...gen } = await this.generator.generate({
      workspace,
      question: content,
      searchQuery: previousQuestion ? `${clip(previousQuestion, 500)}\n${content}` : content,
      history,
      folderId: input.folderId,
      sessionId: conversation.id,
      onToken: input.onToken,
      signal: input.signal,
    });

    const [reply] = await db
      .insert(messages)
      .values({
        id: newId('message'),
        conversationId: conversation.id,
        role: 'assistant',
        content: gen.text,
        status: gen.status,
        grounded: gen.grounded,
        citations: gen.citations,
        provider: gen.provider,
        model: gen.model,
        promptTokens: gen.promptTokens,
        completionTokens: gen.completionTokens,
        latencyMs: gen.latencyMs,
        timeToFirstTokenMs: gen.timeToFirstTokenMs,
        error: gen.error,
        requestId: requestId ?? null,
      })
      .returning();
    await db
      .update(conversations)
      .set({ updatedAt: new Date(), title: conversation.title ?? clip(content, TITLE_CHARS) })
      .where(eq(conversations.id, conversation.id));
    return { reply: reply!, error: failure };
  }
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Conversations are private to whoever started them; admins can read any. */
export function canSeeConversation(c: ConversationRow, caller: Principal): boolean {
  if (caller.kind === 'user' && caller.isAdmin) return true;
  return c.ownerKind === caller.kind && c.ownerId === caller.id;
}

export function toApiConversation(c: ConversationRow, slug: string): Conversation {
  return {
    id: c.id,
    workspace: slug,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toApiMessage(m: MessageRow): Message {
  return {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    status: m.status,
    grounded: m.grounded,
    citations: m.citations.map(withStartSeconds),
    model: m.model,
    usage: { promptTokens: m.promptTokens, completionTokens: m.completionTokens },
    latencyMs: m.latencyMs,
    timeToFirstTokenMs: m.timeToFirstTokenMs,
    error: m.error,
    createdAt: m.createdAt.toISOString(),
  };
}
