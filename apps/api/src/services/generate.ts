import type { StoredCitation, Database, Workspace } from '@rag/db';
import type { ResponseStyle } from '@rag/shared';
import {
  LangflowError,
  messageText,
  messageUsage,
  outputsByComponent,
  parseJsonMessage,
  type LangflowClient,
  type RunRequest,
  type RunResponse,
  type Tweaks,
} from '@rag/langflow-client';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import { FLOWS } from '../flows.js';
import { contextText, searchSources, type SourceHit } from './composite-search.js';
import { normalise, resolveHits, retrieve, searchTweaks } from './passages.js';
import { chatEndpoint, ProviderNotConfigured, type ChatEndpoint } from './providers.js';
import { withWorkspaceKeys } from './provider-keys.js';
import { isRefusal } from './refusal.js';
import { composeSystemPrompt } from './styles.js';

/** The reply when nothing in the workspace is relevant enough. The model is not asked. */
export const NOT_FOUND_TEXT = "I couldn't find anything about this in this workspace's material.";

/**
 * Used when a workspace has no system prompt of its own. The prompt tuned on the OUC course material
 * (docs/tuning.md), with "course material" made general.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  "You answer questions about this workspace's material using only the numbered passages you are given.",
  'Rules:',
  '- Use every relevant passage. If the question has several parts, answer each part from whichever passages cover it, and say only which part the material does not cover.',
  '- If the passages list several items, give the complete list.',
  '- Cite with square brackets after each statement, like [1] or [2][3]. Never use other bracket styles.',
  '- If none of the passages answer the question, say only that the material does not cover it, and cite nothing. Never use outside knowledge.',
  '- If the question does not say what it is about (for example "How does it work?"), do not guess the subject. Ask the user what they mean.',
  '- Transcripts of recordings are automatic and may mishear names. Prefer the other documents for spelling.',
  '- Answer in the language of the question, briefly.',
].join('\n');

const SNIPPET_CHARS = 240;

/**
 * Citation markers in a reply: `[1]`, `[1, 2]`, or the fullwidth `【1】` / `【1†L3-L5】` some models
 * (gpt-oss) write. The admin UI reads the same markers (apps/admin/src/playground/answer.ts).
 */
const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]|【(\d+(?:\s*,\s*\d+)*)(?:†[^】]*)?】/g;

/**
 * Whether a reply rests on the material: it cites at least one of the passages it was given. A model
 * that finds nothing to use in its passages says so without citing any (the system prompt asks it to
 * cite what it uses), so such a reply is not grounded, however well the passages scored.
 */
function citesAny(text: string, ranks: number[]): boolean {
  for (const m of text.matchAll(MARKER)) {
    const cited = (m[1] ?? m[2]!).split(',').map((n) => Number(n.trim()));
    if (cited.some((n) => ranks.includes(n))) return true;
  }
  return false;
}

/**
 * A stored citation as the API returns it, filling what older rows lack: start times, source URLs,
 * and the workspace (before composites, always the one answering, `slug`).
 */
export function toApiCitation(c: StoredCitation, slug: string) {
  return {
    ...c,
    startSeconds: c.startSeconds ?? null,
    sourceUrl: c.sourceUrl ?? null,
    workspace: c.workspace ?? slug,
  };
}

export type GenerateConfig = Pick<
  Config,
  | 'DEFAULT_TOP_K'
  | 'DEFAULT_MIN_SCORE'
  | 'DEFAULT_REASONING_EFFORT'
  | 'DEFAULT_CHAT_PROVIDER'
  | 'DEFAULT_CHAT_MODEL'
  | 'RETRIEVE_TIMEOUT_MS'
  | 'ANSWER_TIMEOUT_MS'
  | 'LMSTUDIO_BASE_URL'
  | 'OPENAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'SECRETS_KEY'
>;

type GenerateInput = {
  workspace: Workspace;
  /** The question or latest message, as the model should read it. */
  question: string;
  /** What to search for, when it differs from the question (a chat follow-up). */
  searchQuery?: string;
  /** Earlier turns as text. Given → the `rw-chat` flow; absent → `rw-answer`. */
  history?: string;
  maxPassages?: number;
  /** Search only this folder (already checked to belong to the workspace). */
  folderId?: string;
  /** Tone, length and format, added after the system prompt. `null`: none. */
  style: ResponseStyle | null;
  /** Langflow session id; one per run, so runs never share Langflow-side memory. */
  sessionId: string;
  /** Stream the reply: called with each piece of text as the model writes it. */
  onToken?: (text: string) => void;
  /** Stops the run, e.g. when a streaming client goes away. */
  signal?: AbortSignal;
};

/** Everything an answer or a chat reply stores. `failure` is set when it failed. */
type Generation = {
  status: 'complete' | 'failed';
  text: string | null;
  grounded: boolean;
  citations: StoredCitation[];
  provider: string | null;
  model: string | null;
  /** The style's slug, recorded whether or not the model was called. */
  style: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  timeToFirstTokenMs: number | null;
  error: string | null;
  failure?: unknown;
};

/**
 * Turns a question into a grounded reply. Shared by answers and conversation messages.
 *
 * 1. Search first (`rw-retrieve`). If nothing reaches the minimum score, reply with a fixed
 *    text: no model call, no made-up answer.
 * 2. Otherwise run `rw-answer` (or `rw-chat` with history), which searches again with the
 *    same settings, builds the prompt and calls the workspace's chat model. Its citations
 *    output is exactly the passages the model saw.
 * 3. The reply is grounded only if it cites one of those passages (`citesAny`) and is not a refusal
 *    (`isRefusal`): passages can score well and still not hold the answer, and then the model says so,
 *    sometimes citing them anyway.
 *
 * Never throws for a failed run: the failure comes back in the result, so callers can store it.
 */
export class Generator {
  constructor(private readonly deps: { db: Database; langflow: LangflowClient; config: GenerateConfig }) {}

  async generate(input: GenerateInput): Promise<Generation> {
    const { db, langflow } = this.deps;
    const { workspace, question, history, maxPassages, folderId, style, sessionId, onToken, signal } = input;
    const searchQuery = input.searchQuery ?? question;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let chat: ChatEndpoint | undefined;
    let timeToFirstTokenMs: number | null = null;
    const empty = {
      citations: [],
      provider: null,
      model: null,
      style: style?.slug ?? null,
      promptTokens: null,
      completionTokens: null,
      error: null,
    };

    try {
      // The workspace's own provider keys, where it has saved any, over the ones in .env. Shadows the
      // API's config so nothing below can reach a key the workspace has replaced.
      const config = await withWorkspaceKeys(db, this.deps.config, workspace.id);
      chat = chatEndpoint(workspace.settings, config);
      const opts = { limit: maxPassages, folderId };
      const composite = workspace.kind === 'composite';
      // Resolve before deciding: a hit whose document was deleted or is not ready doesn't count.
      // A composite searches each source with that source's own model and keys (not its own).
      const hits: SourceHit[] = composite
        ? await searchSources(this.deps, workspace, searchQuery, { limit: maxPassages })
        : (
            await resolveHits(db, workspace, await retrieve(langflow, workspace, searchQuery, config, opts))
          ).map((h) => ({ ...h, workspaceName: workspace.name }));
      if (!hits.length) {
        timeToFirstTokenMs = onToken ? elapsed() : null;
        onToken?.(NOT_FOUND_TEXT);
        return {
          ...empty,
          status: 'complete',
          text: NOT_FOUND_TEXT,
          grounded: false,
          latencyMs: elapsed(),
          timeToFirstTokenMs,
        };
      }

      const flow = composite ? FLOWS.generate : history === undefined ? FLOWS.answer : FLOWS.chat;
      const tweaks: Tweaks = {
        ...(composite ? {} : searchTweaks(workspace, config, opts)),
        LLM: {
          provider: chat.provider,
          model_name: chat.model,
          api_key: chat.apiKey,
          base_url: chat.baseUrl,
          system_message: composeSystemPrompt(
            workspace.settings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
            style,
            workspace.settings.systemPrompt == null,
          ),
          // Empty: not sent, and the model thinks as much as it does by default.
          reasoning_effort: workspace.settings.reasoningEffort ?? config.DEFAULT_REASONING_EFFORT ?? '',
          stream: Boolean(onToken),
        },
      };
      if (composite) {
        // rw-generate has no search: the passages found above are its context, numbered as fused.
        tweaks.Prompt = { context: contextText(hits), history: history || '(this is the first message)' };
      } else if (history !== undefined) {
        // In rw-chat the chat input is the search query; the question and history are set
        // straight on the prompt's own fields, so the flow needs no extra input nodes.
        tweaks.Prompt = { question, history: history || '(this is the first message)' };
      }
      const request: RunRequest = {
        input_value: composite || history === undefined ? question : searchQuery,
        session_id: sessionId,
        tweaks,
      };
      const timeout = AbortSignal.timeout(config.ANSWER_TIMEOUT_MS);
      const runSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
      const run = onToken
        ? await this.stream(flow, request, runSignal, (text) => {
            timeToFirstTokenMs ??= elapsed();
            onToken(text);
          })
        : await langflow.run(flow, request, runSignal);

      const outputs = outputsByComponent(run);
      // rw-answer and rw-chat return the passages the model saw; for rw-generate the API chose them.
      const citationsText = messageText(outputs['ChatOutput-citations']);
      const cited = composite
        ? hits
        : await resolveHits(db, workspace, normalise(citationsText ? parseJsonMessage(citationsText) : []));
      const text = messageText(outputs['ChatOutput-answer']);
      if (!text.trim()) throw new HttpProblem(502, 'The model returned an empty answer.');
      return {
        status: 'complete',
        text,
        // A refusal that cites its passages anyway still rests on nothing (isRefusal).
        grounded:
          !isRefusal(text) &&
          citesAny(
            text,
            cited.map((p) => p.rank),
          ),
        citations: cited.map((p) => ({
          rank: p.rank,
          workspace: p.workspace,
          passageId: p.id,
          documentId: p.documentId,
          documentTitle: p.documentTitle,
          sourceUrl: p.sourceUrl,
          page: p.page,
          startSeconds: p.startSeconds,
          snippet: p.text.length > SNIPPET_CHARS ? `${p.text.slice(0, SNIPPET_CHARS)}…` : p.text,
          score: p.score,
        })),
        provider: chat.provider,
        model: chat.model,
        style: style?.slug ?? null,
        ...messageUsage(outputs['ChatOutput-answer']),
        latencyMs: elapsed(),
        timeToFirstTokenMs,
        error: null,
      };
    } catch (failure) {
      return {
        ...empty,
        status: 'failed',
        text: null,
        grounded: true,
        provider: chat?.provider ?? null,
        model: chat?.model ?? null,
        latencyMs: elapsed(),
        timeToFirstTokenMs,
        error: signal?.aborted ? 'The caller left before the answer finished.' : describe(failure),
        failure,
      };
    }
  }

  /**
   * Run a flow with streaming. Langflow sends `token` events while the model writes and an
   * `end` event with the same result a plain run returns (so citations arrive at the end).
   */
  private async stream(
    flow: string,
    request: RunRequest,
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<RunResponse> {
    for await (const ev of this.deps.langflow.stream(flow, request, signal)) {
      const data = (ev.data ?? {}) as { chunk?: string; text?: string; error?: string; result?: RunResponse };
      if (ev.event === 'token' && data.chunk) onText(data.chunk);
      // Langflow sends the component's message first ("Connection error."), then a long trace.
      if (ev.event === 'error') {
        throw new LangflowError(`stream ${flow}`, 500, (data.text ?? data.error ?? 'failed').trim());
      }
      if (ev.event === 'end') return data.result ?? {};
    }
    throw new LangflowError(`stream ${flow}`, 502, 'the stream ended without a result');
  }
}

/**
 * Short reason stored with a failed reply, and shown to whoever reads it back. Langflow's own
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
