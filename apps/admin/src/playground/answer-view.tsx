import type { Citation } from '@rag/shared';
import { Notice } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useCurrentWorkspace } from '@/workspaces/current';
import { AnswerMarkdown } from './answer-markdown';
import { answerFailure, type AnswerError } from './failure';
import { formatScore } from './search';

/**
 * Generated text rendered as markdown, with its `[n]` markers turned into buttons that open the passage
 * they point at, and a caret while it is still arriving. Ask mode, Chat mode and a stored conversation
 * render the same thing, in their own card.
 */
export function AnswerText({
  text,
  citations,
  streaming,
  onOpen,
}: {
  text: string;
  citations: Citation[];
  streaming: boolean;
  onOpen(passageId: string | null): void;
}) {
  return (
    <div className="answer-md text-[15px] leading-relaxed">
      <AnswerMarkdown
        text={text}
        ranks={citations.map((c) => c.rank)}
        streaming={streaming}
        renderCitation={(rank) => (
          <CitationMarker rank={rank} onOpen={() => onOpen(passageOfRank(citations, rank))} />
        )}
      />
    </div>
  );
}

/** The passage a `[n]` marker points at; null when the answer cites a rank it did not send. */
function passageOfRank(citations: Citation[], rank: number): string | null {
  return citations.find((c) => c.rank === rank)?.passageId ?? null;
}

/** The `[n]` in the text: opens the passage it points at. */
function CitationMarker({ rank, onOpen }: { rank: number; onOpen(): void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Source ${rank}`}
      className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded border border-indigo-200 bg-indigo-50 px-1.5 align-[1px] text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100"
    >
      {rank}
    </button>
  );
}

/** The passages the model was given, best first, each opening its full text. */
export function Sources({ citations, onOpen }: { citations: Citation[]; onOpen(passageId: string): void }) {
  return (
    <aside aria-label="Sources" className="flex max-w-95 flex-[1_1_300px] flex-col gap-2.5">
      <p className="text-[13px] font-semibold">
        Sources{' '}
        <span className="text-muted-foreground font-normal">· {citations.length} given to the model</span>
      </p>
      {citations.map((c) => (
        <button
          key={c.passageId}
          type="button"
          data-testid="source"
          onClick={() => onOpen(c.passageId)}
          className="bg-card hover:border-ring flex w-full flex-col gap-1.5 rounded-xl border p-3 text-left"
        >
          <span className="flex w-full items-center gap-2">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-indigo-200 bg-indigo-50 px-1.5 text-[11px] font-semibold text-indigo-800">
              {c.rank}
            </span>
            <span className="flex-1 truncate text-[13px] font-semibold">{c.documentTitle}</span>
            <span className="text-muted-foreground font-mono text-xs">{formatScore(c.score)}</span>
          </span>
          {c.page !== null && <span className="text-muted-foreground text-xs">page {c.page}</span>}
          <span className="text-[13px] leading-snug">“{c.snippet}”</span>
        </button>
      ))}
    </aside>
  );
}

/**
 * A refused or failed answer, with the reason the API gave and the reindex case named. `onRetry` is
 * null when trying again would interrupt something, which is what Chat does while a reply streams.
 */
export function AnswerFailure({ error, onRetry }: { error: AnswerError; onRetry: (() => void) | null }) {
  const w = useCurrentWorkspace();
  const { title, body } = answerFailure(error, w.status);
  return (
    <Notice title={title} body={body} alert>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Notice>
  );
}
