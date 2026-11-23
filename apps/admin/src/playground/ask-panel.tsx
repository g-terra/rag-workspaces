import type { Answer, Citation } from '@rag/shared';
import { Search, Sparkles, SquareIcon, ThumbsDown, ThumbsUp, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Notice } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCurrentWorkspace } from '@/workspaces/current';
import { answerMeta, answerParts } from './answer';
import { answerFailure, type AnswerError } from './failure';
import { feedbackNote, type Rating } from './feedback';
import { PassageDialog } from './passage-dialog';
import { Passages, QuestionBox } from './question-box';
import { useAnswerFeedback } from './queries';
import { formatScore } from './search';
import { useAsk } from './use-ask';

/** How many passages the model is given. Leaving it out would use the workspace's own `topK`. */
const PASSAGE_COUNTS = [3, 5, 8];
const DEFAULT_PASSAGES = 5;

/** The playground's Ask mode: a question, a streamed answer, its sources and a rating. */
export function AskPanel() {
  const w = useCurrentWorkspace();
  const ask = useAsk(w.slug);
  const [question, setQuestion] = useState('');
  const [maxPassages, setMaxPassages] = useState(DEFAULT_PASSAGES);
  const [openPassage, setOpenPassage] = useState<string | null>(null);
  const streaming = ask.status === 'streaming';
  const citations = ask.answer?.citations ?? [];
  const submit = () => {
    if (question.trim()) ask.ask(question.trim(), maxPassages);
  };

  return (
    <>
      <QuestionBox
        id="question"
        label="Question"
        placeholder="What is retrieval-augmented generation?"
        value={question}
        onChange={setQuestion}
        onSubmit={submit}
      >
        <Passages value={maxPassages} onChange={setMaxPassages} counts={PASSAGE_COUNTS} />
        {streaming ? (
          <Button size="sm" variant="outline" onClick={ask.stop}>
            <SquareIcon /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={submit} disabled={!question.trim()}>
            <Sparkles /> Ask <span className="text-primary-foreground/60 font-mono text-xs">Ctrl ↵</span>
          </Button>
        )}
      </QuestionBox>

      {ask.error && ask.status === 'failed' && <Failure error={ask.error} onRetry={submit} />}

      {ask.answer?.grounded === false ? (
        <NotFound slug={w.slug} question={ask.question}>
          <AnswerFeedback answer={ask.answer} onRated={ask.rated} />
        </NotFound>
      ) : (
        (streaming || ask.text !== '' || ask.status === 'stopped') && (
          <div className="flex flex-wrap items-start gap-4">
            <div className="bg-card flex min-w-0 flex-[999_1_460px] flex-col gap-4 rounded-xl border p-5">
              {ask.answer && (
                <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
                  <span className="font-mono">{ask.answer.id}</span>
                  <span data-testid="answer-meta">{answerMeta(ask.answer)}</span>
                </div>
              )}
              <p data-testid="answer" className="text-[15px] leading-relaxed whitespace-pre-wrap">
                {answerParts(
                  ask.text,
                  citations.map((c) => c.rank),
                ).map((part, i) =>
                  'rank' in part ? (
                    <CitationMarker
                      key={i}
                      rank={part.rank}
                      onOpen={() => setOpenPassage(passageOfRank(citations, part.rank))}
                    />
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
                {streaming && <span className="bg-foreground ml-0.5 inline-block h-4 w-1.5 animate-pulse" />}
              </p>
              {ask.status === 'stopped' && (
                <p className="text-muted-foreground border-t pt-3 text-[13px]">
                  Stopped. What had arrived is above; the API still stored the whole answer.
                </p>
              )}
              {ask.status === 'done' && ask.answer && (
                <AnswerFeedback answer={ask.answer} onRated={ask.rated} />
              )}
            </div>
            {citations.length > 0 && <Sources citations={citations} onOpen={setOpenPassage} />}
          </div>
        )
      )}

      <PassageDialog slug={w.slug} passageId={openPassage} onClose={() => setOpenPassage(null)} />
    </>
  );
}

/** Thumbs up or down on an answer, with an optional comment after a thumbs down. */
function AnswerFeedback({ answer, onRated }: { answer: Answer; onRated(answer: Answer): void }) {
  const w = useCurrentWorkspace();
  const feedback = useAnswerFeedback(w.slug);
  const [comment, setComment] = useState('');
  const rating = answer.feedback?.rating ?? null;
  const rate = (next: Rating) =>
    feedback.mutate({ answerId: answer.id, rating: next, comment }, { onSuccess: onRated });

  return (
    <div className="flex flex-col gap-2.5 border-t pt-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground mr-1 text-[13px]">Was this helpful?</span>
        <Thumb
          label="Helpful"
          pressed={rating === 'up'}
          busy={feedback.isPending}
          tone="bg-green-100 border-green-300 text-green-800"
          onClick={() => rate('up')}
        >
          <ThumbsUp className="size-4" />
        </Thumb>
        <Thumb
          label="Not helpful"
          pressed={rating === 'down'}
          busy={feedback.isPending}
          tone="bg-red-100 border-red-300 text-red-800"
          onClick={() => rate('down')}
        >
          <ThumbsDown className="size-4" />
        </Thumb>
        <span className="text-[13px] text-green-800">{feedbackNote(answer.feedback)}</span>
      </div>
      {rating === 'down' && (
        <div className="flex flex-wrap gap-2">
          <Input
            className="flex-[1_1_240px]"
            aria-label="Feedback comment"
            placeholder="What was wrong? (optional, saved with the rating)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={feedback.isPending || !comment.trim()}
            onClick={() => rate('down')}
          >
            Send
          </Button>
        </div>
      )}
      {feedback.isError && (
        <p className="text-[13px] text-red-800" role="alert">
          {feedback.error.message}
        </p>
      )}
    </div>
  );
}

function Thumb({
  label,
  pressed,
  busy,
  tone,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  busy: boolean;
  tone: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={busy}
      onClick={onClick}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-lg border disabled:opacity-50',
        // Hovering the chosen thumb must not make it look unchosen.
        pressed ? tone : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
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
function Sources({ citations, onOpen }: { citations: Citation[]; onOpen(passageId: string): void }) {
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

/** A refused or failed answer, with the reason the API gave and the reindex case named. */
function Failure({ error, onRetry }: { error: AnswerError; onRetry(): void }) {
  const w = useCurrentWorkspace();
  const { title, body } = answerFailure(error, w.status);
  return (
    <Notice title={title} body={body} alert>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </Notice>
  );
}

/**
 * Nothing in the workspace was relevant enough, so no model was called (`grounded: false`). The API
 * still stored the answer, so it can be rated: a question the workspace should have covered is exactly
 * the one worth flagging.
 */
function NotFound({ slug, question, children }: { slug: string; question: string; children: ReactNode }) {
  return (
    <div className="bg-card flex flex-col gap-4 rounded-xl border p-7">
      <div className="flex flex-wrap items-start gap-4">
        <span className="bg-accent inline-flex size-10 flex-none items-center justify-center rounded-lg">
          <Search className="size-5" />
        </span>
        <div className="flex-[1_1_300px]">
          <h2 className="mb-1.5 text-[15px] font-semibold">Not found in this workspace</h2>
          <p className="text-muted-foreground mb-3.5 text-sm leading-relaxed">
            No passage was close enough to “{question}”, so no answer was generated. Upload material that
            covers it, or ask in the words the material uses.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/w/${slug}/upload`}>
              <Upload /> Upload material
            </Link>
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
