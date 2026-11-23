import { describe, expect, it } from 'vitest';
import { answerFailure } from './failure';

describe('answerFailure', () => {
  it('names reindexing when the workspace is being reindexed and the API refused', () => {
    expect(answerFailure({ status: 503, detail: 'Workspace ouc is being reindexed.' }, 'reindexing')).toEqual(
      {
        title: 'This workspace is being reindexed',
        body: 'Answers are paused while the material is indexed again. Try again shortly.',
      },
    );
  });

  it('keeps the API reason for a 503 that is not reindexing', () => {
    expect(answerFailure({ status: 503, detail: 'Langflow is still starting.' }, 'active')).toEqual({
      title: "The workspace can't answer right now",
      body: 'Langflow is still starting.',
    });
  });

  // A reindexing workspace whose failure is nothing to do with reindexing keeps its own reason.
  it('keeps the API reason for other statuses, even while reindexing', () => {
    expect(answerFailure({ status: 502, detail: 'Answering failed in Langflow.' }, 'reindexing')).toEqual({
      title: 'The answer failed',
      body: 'Answering failed in Langflow.',
    });
  });

  it('says when the answer took too long', () => {
    expect(answerFailure({ status: 504, detail: 'Answering took too long.' }, 'active')).toEqual({
      title: 'The answer took too long',
      body: 'Answering took too long.',
    });
  });

  it('falls back to the plain failure when the API gave no status', () => {
    expect(answerFailure({ status: null, detail: 'Failed to fetch' }, 'active')).toEqual({
      title: 'The answer failed',
      body: 'Failed to fetch',
    });
  });
});
