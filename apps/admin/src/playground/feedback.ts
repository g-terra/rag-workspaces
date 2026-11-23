import type { Answer, Feedback } from '@rag/shared';

/** The longest comment `POST …/answers/{id}/feedback` accepts. */
const COMMENT_MAX = 2000;

export type Rating = Feedback['rating'];

/** The body for `POST …/answers/{id}/feedback`: an empty comment is `null`, not an empty string. */
export function feedbackBody(rating: Rating, comment: string): { rating: Rating; comment: string | null } {
  const trimmed = comment.trim().slice(0, COMMENT_MAX);
  return { rating, comment: trimmed || null };
}

/** What to say once an answer has been rated, from the answer the API sent back. */
export function feedbackNote(feedback: Answer['feedback']): string {
  if (!feedback) return '';
  return feedback.comment ? 'Thanks, feedback and comment saved' : 'Thanks, feedback saved';
}
