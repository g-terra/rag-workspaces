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
  type RunRequest,
  type RunResponse,
} from '@rag/langflow-client';
import type { Answer } from '@rag/shared';
import type { Principal } from '../auth/principal.js';
import type { Config } from '../config.js';
import { FLOWS } from '../flows.js';
import { normalise, resolveHits, retrieve, searchTweaks } from './passages.js';
import { chatEndpoint, type ChatEndpoint } from './providers.js';

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
  /** Stream the reply: called with each piece of text as the model writes it. */
  onToken?: (text: string) => void;
  /** Stops the run, e.g. when a streaming client goes away. */
  signal?: AbortSignal;
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
    const { workspace, caller, question, maxPassages, requestId, onToken, signal } = input;
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
    let timeToFirstTokenMs: number | null = null;

    try {
      chat = chatEndpoint(workspace.settings, config);
      const opts = { limit: maxPassages };
      const hits = await retrieve(langflow, workspace, question, config, opts);
      if (!hits.length) {
        onToken?.(NOT_FOUND_TEXT);
        return {
          answer: await this.store({ ...base, text: NOT_FOUND_TEXT, grounded: false, latencyMs: elapsed() }),
        };
      }

      const request: RunRequest = {
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
            stream: Boolean(onToken),
          },
        },
      };
      const timeout = AbortSignal.timeout(config.ANSWER_TIMEOUT_MS);
      const runSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
      let run: RunResponse;
      if (onToken) {
        run = await this.stream(request, runSignal, (text) => {
          timeToFirstTokenMs ??= elapsed();
          onToken(text);
        });
      } else {
        run = await langflow.run(FLOWS.answer, request, runSignal);
      }
      const outputs = outputsByComponent(run);
      const citationsText = messageText(outputs['ChatOutput-citations']);
      const cited = await resolveHits(
        db,
        workspace.id,
        normalise(citationsText ? parseJsonMessage(citationsText) : []),
      );
      const usage = messageUsage(outputs['ChatOutput-answer']);
      return {
        answer: await this.store({
          ...base,
          text: messageText(outputs['ChatOutput-answer']),
          citations: cited.map((p): StoredCitation => ({
            rank: p.rank,
            passageId: p.id,
            documentId: p.documentId,
            documentTitle: p.documentTitle,
            folderId: p.folderId,
            page: p.page,
            startSeconds: p.startSeconds,
            snippet: p.text.length > SNIPPET_CHARS ? `${p.text.slice(0, SNIPPET_CHARS)}…` : p.text,
            score: p.score,
          })),
          provider: chat.provider,
          model: chat.model,
          ...usage,
          latencyMs: elapsed(),
          timeToFirstTokenMs,
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
        timeToFirstTokenMs,
      });
      return { answer, error };
    }
  }

  /**
   * Run `rw-answer` with streaming. Langflow sends `token` events while the model writes and
   * an `end` event with the same result a plain run returns (so citations arrive at the end).
   */
  private async stream(
    request: RunRequest,
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<RunResponse> {
    for await (const ev of this.deps.langflow.stream(FLOWS.answer, request, signal)) {
      const data = (ev.data ?? {}) as { chunk?: string; text?: string; error?: string; result?: RunResponse };
      if (ev.event === 'token' && data.chunk) onText(data.chunk);
      // Langflow sends the component's message first ("Connection error."), then a long trace.
      if (ev.event === 'error') {
        throw new LangflowError(`stream ${FLOWS.answer}`, 500, (data.text ?? data.error ?? 'failed').trim());
      }
      if (ev.event === 'end') return data.result ?? {};
    }
    throw new LangflowError(`stream ${FLOWS.answer}`, 502, 'the stream ended without a result');
  }

  private async store(row: NewAnswer): Promise<AnswerRow> {
    const [stored] = await this.deps.db.insert(answers).values(row).returning();
    return stored!;
  }
}

/** Short reason stored with a failed answer. */
function describe(err: unknown): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return 'The answer took too long and was stopped.';
  }
  if (err instanceof LangflowError) return err.detail || err.message;
  return err instanceof Error ? err.message : String(err);
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
