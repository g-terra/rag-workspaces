import {
  answers,
  newId,
  type Answer as AnswerRow,
  type Database,
  type NewAnswer,
  type StoredCitation,
  type Workspace,
} from '@rag/db';
import {
  LangflowError,
  messageText,
  messageUsage,
  outputsByComponent,
  parseJsonMessage,
  type LangflowClient,
} from '@rag/langflow-client';
import type { Answer } from '@rag/shared';
import type { Principal } from '../auth/principal.js';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import { FLOWS } from '../flows.js';
import { normalise, resolveHits, retrieve, searchTweaks } from './passages.js';
import { chatEndpoint, ProviderNotConfigured, type ChatEndpoint } from './providers.js';

/** The reply when nothing in the workspace is relevant enough. The model is not asked. */
export const NOT_FOUND_TEXT = "I couldn't find anything about this in this workspace's material.";

/** Used when a workspace has no system prompt of its own. */
export const DEFAULT_SYSTEM_PROMPT =
  'You answer questions using only the numbered passages you are given. ' +
  'Cite the passages you use as [n]. If the passages do not contain the answer, ' +
  'say that the material does not cover it. Answer in the language of the question.';

const SNIPPET_CHARS = 240;

export type AnswerConfig = Pick<
  Config,
  | 'DEFAULT_TOP_K'
  | 'DEFAULT_MIN_SCORE'
  | 'DEFAULT_CHAT_PROVIDER'
  | 'DEFAULT_CHAT_MODEL'
  | 'RETRIEVE_TIMEOUT_MS'
  | 'ANSWER_TIMEOUT_MS'
  | 'LMSTUDIO_BASE_URL'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'ANTHROPIC_API_KEY'
>;

export type AskInput = {
  workspace: Workspace;
  caller: Principal;
  question: string;
  maxPassages?: number;
  requestId?: string;
};

/** The stored answer, plus the error that made it fail (for the route to turn into a problem response). */
export type AskResult = { answer: AnswerRow; error?: unknown };

/**
 * Answers one question from a workspace's material and stores the result, success or not.
 *
 * 1. Search first (`rw-retrieve`). If nothing reaches the minimum score, store an
 *    ungrounded answer with a fixed text: no model call, no made-up answer.
 * 2. Otherwise run `rw-answer`, which searches again with the same settings, builds the
 *    prompt and calls the workspace's chat model. Its citations output is exactly the
 *    passages the model saw.
 */
export class AnswerService {
  constructor(private readonly deps: { db: Database; langflow: LangflowClient; config: AnswerConfig }) {}

  async ask(input: AskInput): Promise<AskResult> {
    const { db, langflow, config } = this.deps;
    const { workspace, caller, question, maxPassages, requestId } = input;
    const started = performance.now();
    const base: NewAnswer = {
      id: newId('answer'),
      workspaceId: workspace.id,
      askedByKind: caller.kind,
      askedBy: caller.id,
      question,
      requestId: requestId ?? null,
      status: 'complete',
      grounded: true,
      latencyMs: 0,
    };
    const elapsed = () => Math.round(performance.now() - started);
    let chat: ChatEndpoint | undefined;

    try {
      chat = chatEndpoint(workspace.settings, config);
      const opts = { limit: maxPassages };
      // Resolve before deciding: a hit whose document was deleted or is not ready doesn't count.
      const hits = await resolveHits(
        db,
        workspace.id,
        await retrieve(langflow, workspace, question, config, opts),
      );
      if (!hits.length) {
        return {
          answer: await this.store({ ...base, text: NOT_FOUND_TEXT, grounded: false, latencyMs: elapsed() }),
        };
      }

      const run = await langflow.run(
        FLOWS.answer,
        {
          input_value: question,
          session_id: base.id!,
          tweaks: {
            ...searchTweaks(workspace, config, opts),
            LLM: {
              provider: chat.provider,
              model_name: chat.model,
              api_key: chat.apiKey,
              base_url: chat.baseUrl,
              system_message: workspace.settings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
              stream: false,
            },
          },
        },
        AbortSignal.timeout(config.ANSWER_TIMEOUT_MS),
      );
      const outputs = outputsByComponent(run);
      const citationsText = messageText(outputs['ChatOutput-citations']);
      const cited = await resolveHits(
        db,
        workspace.id,
        normalise(citationsText ? parseJsonMessage(citationsText) : []),
      );
      const usage = messageUsage(outputs['ChatOutput-answer']);
      const text = messageText(outputs['ChatOutput-answer']);
      if (!text.trim()) throw new HttpProblem(502, 'The model returned an empty answer.');
      return {
        answer: await this.store({
          ...base,
          text,
          citations: cited.map((p): StoredCitation => ({
            rank: p.rank,
            passageId: p.id,
            documentId: p.documentId,
            documentTitle: p.documentTitle,
            page: p.page,
            snippet: p.text.length > SNIPPET_CHARS ? `${p.text.slice(0, SNIPPET_CHARS)}…` : p.text,
            score: p.score,
          })),
          provider: chat.provider,
          model: chat.model,
          ...usage,
          latencyMs: elapsed(),
        }),
      };
    } catch (error) {
      const answer = await this.store({
        ...base,
        status: 'failed',
        provider: chat?.provider ?? null,
        model: chat?.model ?? null,
        error: describe(error),
        latencyMs: elapsed(),
      });
      return { answer, error };
    }
  }

  private async store(row: NewAnswer): Promise<AnswerRow> {
    const [stored] = await this.deps.db.insert(answers).values(row).returning();
    return stored!;
  }
}

/**
 * Short reason stored with a failed answer, and shown to whoever reads it back. Langflow's own
 * message and our own problems are meant for people; anything else may be internal, so it is
 * described generically (the route logs the real error).
 */
function describe(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return 'The answer took too long and was stopped.';
  }
  if (err instanceof LangflowError) return err.detail || err.message;
  if (err instanceof HttpProblem || err instanceof ProviderNotConfigured) return err.message;
  return 'Something went wrong while answering.';
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
    citations: a.citations,
    provider: a.provider,
    model: a.model,
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
