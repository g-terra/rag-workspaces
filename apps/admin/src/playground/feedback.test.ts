import { describe, expect, it } from 'vitest';
import { feedbackBody, feedbackNote } from './feedback';

describe('feedbackBody', () => {
  it('sends the rating with the trimmed comment', () => {
    expect(feedbackBody('down', '  the dates are wrong  ')).toEqual({
      rating: 'down',
      comment: 'the dates are wrong',
    });
  });

  it('sends no comment when there is nothing in it', () => {
    expect(feedbackBody('up', '   ')).toEqual({ rating: 'up', comment: null });
    expect(feedbackBody('up', '')).toEqual({ rating: 'up', comment: null });
  });

  // The API accepts 2000 characters, so a longer comment is cut rather than refused.
  it('cuts a comment at the length the API accepts', () => {
    const body = feedbackBody('down', 'x'.repeat(2500));
    expect(body.comment).toHaveLength(2000);
  });
});

describe('feedbackNote', () => {
  it('says nothing until the answer has been rated', () => {
    expect(feedbackNote(null)).toBe('');
  });

  it('thanks for a rating, and says when a comment went with it', () => {
    expect(feedbackNote({ rating: 'up', comment: null, createdAt: '2026-11-23T10:00:00.000Z' })).toBe(
      'Thanks, feedback saved',
    );
    expect(feedbackNote({ rating: 'down', comment: 'wrong', createdAt: '2026-11-23T10:00:00.000Z' })).toBe(
      'Thanks, feedback and comment saved',
    );
  });
});
