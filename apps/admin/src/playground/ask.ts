import type { Answer } from '@rag/shared';

export type AskState = {
  status: 'idle' | 'streaming' | 'done' | 'failed' | 'stopped';
  /** The question that was asked, which the "not found" card repeats back. */
  question: string;
  /** The answer so far: the streamed tokens, then the stored record's text. */
  text: string;
  /** The stored answer, once the API sent it; it carries the citations and the meta line. */
  answer: Answer | null;
  error: string | null;
};

export type AskEvent =
  | { type: 'started'; question: string }
  | { type: 'token'; text: string }
  | { type: 'done'; answer: Answer }
  | { type: 'failed'; detail: string }
  | { type: 'stopped' };

export const idleAsk: AskState = {
  status: 'idle',
  question: '',
  text: '',
  answer: null,
  error: null,
};

/**
 * One asked question, from the first token to the stored answer. Everything after `stopped` is ignored:
 * the stream is aborted but its last events can still be in flight, and the person asked for them to stop.
 */
export function askReducer(state: AskState, event: AskEvent): AskState {
  if (event.type === 'started') {
    return { status: 'streaming', question: event.question, text: '', answer: null, error: null };
  }
  if (state.status !== 'streaming') return state;
  switch (event.type) {
    case 'token':
      return { ...state, text: state.text + event.text };
    case 'done':
      return { ...state, status: 'done', text: event.answer.text ?? state.text, answer: event.answer };
    case 'failed':
      return { ...state, status: 'failed', error: event.detail };
    case 'stopped':
      return { ...state, status: 'stopped' };
  }
}
