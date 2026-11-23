import type { Answer, Feedback } from '@rag/shared';

/**
 * The longest comment `POST …/answers/{id}/feedback` accepts, from `Feedback` in `@rag/shared`.
 * `feedback.test.ts` checks this against that schema, so lowering it there fails the test here.
 */
const COMMENT_MAX = 2000;

export type Rating = Feedback['rating'];

/**
 * The body for `POST …/answers/{id}/feedback`. An empty comment is `null`, not an empty string, and a
 * comment only goes with a thumbs down: the box that collects it is only offered for one, so sending it
 * with a thumbs up would store an explanation of the opposite rating, where nothing shows it again.
 */
export function feedbackBody(rating: Rating, comment: string): { rating: Rating; comment: string | null } {
  const trimmed = rating === 'down' ? comment.trim().slice(0, COMMENT_MAX) : '';
  return { rating, comment: trimmed || null };
}

/** What to say once an answer has been rated, from the answer the API sent back. */
export function feedbackNote(feedback: Answer['feedback']): string {
  if (!feedback) return '';
  return feedback.comment ? 'Thanks, feedback and comment saved' : 'Thanks, feedback saved';
}
