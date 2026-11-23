import type { Answer, Workspace } from '@rag/shared';
import { Search, Sparkles, SquareIcon, ThumbsDown, ThumbsUp, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { WORKSPACE_DEFAULT } from '@/styles/styles';
import { useCurrentWorkspace } from '@/workspaces/current';
import { answerMeta, foundNothing, UNCITED } from './answer';
import { AnswerFailure, AnswerText, Sources } from './answer-view';
import { feedbackNote, type Rating } from './feedback';
import { PassageDialog } from './passage-dialog';
import { StylePicker } from './style-picker';
import { Passages, QuestionBox } from './question-box';
import { useAnswerFeedback } from './queries';
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
  const [style, setStyle] = useState(WORKSPACE_DEFAULT);
  const [openPassage, setOpenPassage] = useState<string | null>(null);
  const streaming = ask.status === 'streaming';
  const citations = ask.answer?.citations ?? [];
  const submit = () => {
    if (question.trim()) ask.ask(question.trim(), maxPassages, style);
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
        <div className="flex flex-wrap items-center gap-2">
          <Passages value={maxPassages} onChange={setMaxPassages} counts={PASSAGE_COUNTS} />
          <StylePicker value={style} onChange={setStyle} />
        </div>
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

      {ask.error && ask.status === 'failed' && <AnswerFailure error={ask.error} onRetry={submit} />}

      {ask.answer && foundNothing(ask.answer) ? (
        <NotFound workspace={w} question={ask.question}>
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
              <div data-testid="answer">
                <AnswerText
                  text={ask.text}
                  citations={citations}
                  streaming={streaming}
                  onOpen={setOpenPassage}
                />
              </div>
              {ask.answer?.grounded === false && (
                <p className="text-muted-foreground border-t pt-3 text-[13px]" data-testid="uncited">
                  {UNCITED}
                </p>
              )}
              {ask.status === 'stopped' && (
                <p className="text-muted-foreground border-t pt-3 text-[13px]">
                  Stopped. What had arrived is above; the API stopped generating too and stored the answer as
                  it stood.
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

/**
 * Nothing in the workspace was relevant enough, so no model was called (`grounded: false`). The API
 * still stored the answer, so it can be rated: a question the workspace should have covered is exactly
 * the one worth flagging.
 */
function NotFound({
  workspace,
  question,
  children,
}: {
  workspace: Workspace;
  question: string;
  children: ReactNode;
}) {
  // A composite has no upload of its own: its material is added in its source workspaces.
  const composite = workspace.kind === 'composite';
  return (
    <div className="bg-card flex flex-col gap-4 rounded-xl border p-7">
      <div className="flex flex-wrap items-start gap-4">
        <span className="bg-accent inline-flex size-10 flex-none items-center justify-center rounded-lg">
          <Search className="size-5" />
        </span>
        <div className="flex-[1_1_300px]">
          <h2 className="mb-1.5 text-[15px] font-semibold">Not found in this workspace</h2>
          <p className="text-muted-foreground mb-3.5 text-sm leading-relaxed">
            No passage was close enough to “{question}”, so no answer was generated.{' '}
            {composite
              ? `Add material that covers it to one of its sources (${workspace.sources?.join(', ')}), or ask in the words the material uses.`
              : 'Upload material that covers it, or ask in the words the material uses.'}
          </p>
          {!composite && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/w/${workspace.slug}/upload`}>
                <Upload /> Upload material
              </Link>
            </Button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
