import type { Conversation, Message } from '@rag/shared';
import { NOT_GROUNDED } from '@/playground/answer';

/** What a conversation is called in the list. The API titles it from its first message. */
export function conversationName({ title }: Conversation): string {
  return title?.trim() ? title : 'Untitled conversation';
}

/**
 * What a stored message shows: what was written, or why there is nothing. A reply that failed part-way
 * through has both, and then the words it managed are the text and the reason is shown beside them.
 */
export function messageBody({ content, status, grounded, error }: Message): {
  text: string;
  error: string | null;
  failed: boolean;
} {
  if (status === 'failed') {
    return { text: content ?? '', error: error ?? 'The reply failed.', failed: true };
  }
  if (grounded === false) return { text: content ?? NOT_GROUNDED, error: null, failed: false };
  return { text: content ?? '', error: null, failed: false };
}
