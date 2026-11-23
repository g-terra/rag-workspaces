import { answers, newId, type Answer as AnswerRow, type Database, type Workspace } from '@rag/db';
import type { LangflowClient } from '@rag/langflow-client';
import type { Answer, ResponseStyle } from '@rag/shared';
import type { Principal } from '../auth/principal.js';
import { Generator, toApiCitation, type GenerateConfig } from './generate.js';

export { DEFAULT_SYSTEM_PROMPT, NOT_FOUND_TEXT } from './generate.js';

export type AskInput = {
  workspace: Workspace;
  caller: Principal;
  question: string;
  maxPassages?: number;
  folderId?: string;
  style: ResponseStyle | null;
  requestId?: string;
  /** Stream the reply: called with each piece of text as the model writes it. */
  onToken?: (text: string) => void;
  /** Stops the run, e.g. when a streaming client goes away. */
  signal?: AbortSignal;
};

/** The stored answer, plus the error that made it fail (for the route to turn into a problem response). */
export type AskResult = { answer: AnswerRow; error?: unknown };

/** Answers one question (see `Generator`) and stores the result, success or not. */
export class AnswerService {
  private readonly generator: Generator;

  constructor(private readonly deps: { db: Database; langflow: LangflowClient; config: GenerateConfig }) {
    this.generator = new Generator(deps);
  }

  async ask(input: AskInput): Promise<AskResult> {
    const id = newId('answer');
    const { failure, ...gen } = await this.generator.generate({
      workspace: input.workspace,
      question: input.question,
      maxPassages: input.maxPassages,
      folderId: input.folderId,
      style: input.style,
      sessionId: id,
      onToken: input.onToken,
      signal: input.signal,
    });
    const [answer] = await this.deps.db
      .insert(answers)
      .values({
        id,
        workspaceId: input.workspace.id,
        askedByKind: input.caller.kind,
        askedBy: input.caller.id,
        question: input.question,
        requestId: input.requestId ?? null,
        ...gen,
      })
      .returning();
    return { answer: answer!, error: failure };
  }
}

/** Only the caller who asked, and admins, can read an answer back or rate it. */
export function canSee(answer: AnswerRow, caller: Principal): boolean {
  if (caller.kind === 'user' && caller.isAdmin) return true;
  return answer.askedByKind === caller.kind && answer.askedBy === caller.id;
}

export function toApiAnswer(a: AnswerRow, slug: string): Answer {
  return {
    id: a.id,
    workspace: slug,
    question: a.question,
    text: a.text,
    status: a.status,
    grounded: a.grounded,
    citations: a.citations.map((c) => toApiCitation(c, slug)),
    provider: a.provider,
    model: a.model,
    style: a.style,
    usage: { promptTokens: a.promptTokens, completionTokens: a.completionTokens },
    latencyMs: a.latencyMs,
    timeToFirstTokenMs: a.timeToFirstTokenMs,
    error: a.error,
    feedback:
      a.feedbackRating && a.feedbackAt
        ? { rating: a.feedbackRating, comment: a.feedbackComment, createdAt: a.feedbackAt.toISOString() }
        : null,
    createdAt: a.createdAt.toISOString(),
  };
}
