import type { Workspace } from '@rag/shared';

/** Why an answer did not arrive: the HTTP status the API gave, if any, and its reason. */
export type AnswerError = { status: number | null; detail: string };

/**
 * What to tell the person about a refused or failed answer.
 *
 * A `503` means the workspace cannot answer at the moment, which has two very different causes: the
 * material is being indexed again (the API pauses answers and asks for a retry), or the model behind it
 * is not reachable. The workspace's own `status` is what tells them apart, so a reindex says so plainly
 * instead of reading like a broken model. Every other failure keeps the API's own reason, which already
 * names what went wrong.
 */
export function answerFailure(
  { status, detail }: AnswerError,
  workspaceStatus: Workspace['status'],
): { title: string; body: string } {
  if (status === 503) {
    return workspaceStatus === 'reindexing'
      ? {
          title: 'This workspace is being reindexed',
          body: 'Answers are paused while the material is indexed again. Try again shortly.',
        }
      : { title: "The workspace can't answer right now", body: detail };
  }
  if (status === 504) return { title: 'The answer took too long', body: detail };
  return { title: 'The answer failed', body: detail };
}
