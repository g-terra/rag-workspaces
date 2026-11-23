import type { Message } from '@rag/shared';
import type { AnswerError } from './failure';

/** One exchange: what you sent, and the reply as it arrives. */
export interface ChatTurn {
  question: string;
  /** The reply so far: the streamed tokens, then the stored message's content. */
  text: string;
  /** The stored reply, once the API sent it; it carries the citations and the meta line. */
  reply: Message | null;
  error: AnswerError | null;
  status: 'streaming' | 'done' | 'failed' | 'stopped';
}

export interface ChatState {
  turns: ChatTurn[];
}

export type ChatEvent =
  | { type: 'sent'; question: string }
  | { type: 'token'; text: string }
  | { type: 'done'; reply: Message }
  | { type: 'failed'; error: AnswerError }
  | { type: 'stopped' }
  /** A new conversation: the thread starts empty again. */
  | { type: 'cleared' };

export const idleChat: ChatState = { turns: [] };

/** The turn being answered, which every event but `sent` is about. */
export function lastTurn(state: ChatState): ChatTurn | null {
  return state.turns[state.turns.length - 1] ?? null;
}

/**
 * The thread, one turn at a time. Only the newest turn ever changes, and only while it is streaming:
 * the stream is aborted on `stopped`, but its last events can still be in flight, and the person asked
 * for them to stop.
 */
export function chatReducer(state: ChatState, event: ChatEvent): ChatState {
  if (event.type === 'cleared') return idleChat;
  if (event.type === 'sent') {
    const turn: ChatTurn = {
      question: event.question,
      text: '',
      reply: null,
      error: null,
      status: 'streaming',
    };
    return { turns: [...state.turns, turn] };
  }
  const turn = lastTurn(state);
  if (!turn || turn.status !== 'streaming') return state;
  return { turns: [...state.turns.slice(0, -1), answer(turn, event)] };
}

function answer(turn: ChatTurn, event: Exclude<ChatEvent, { type: 'sent' } | { type: 'cleared' }>) {
  switch (event.type) {
    case 'token':
      return { ...turn, text: turn.text + event.text };
    case 'done':
      // A failed reply has no content, so what streamed before it failed is all there is to show.
      return { ...turn, status: 'done' as const, text: event.reply.content ?? turn.text, reply: event.reply }; // prettier-ignore
    case 'failed':
      return { ...turn, status: 'failed' as const, error: event.error };
    case 'stopped':
      return { ...turn, status: 'stopped' as const };
  }
}
