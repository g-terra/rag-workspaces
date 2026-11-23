import type { Citation } from '@rag/shared';
import { Search, Sparkles, SquareIcon, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Notice } from '@/components/states';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { answerMeta, answerParts } from '@/playground/answer';
import { answerFailure, type AnswerError } from '@/playground/failure';
import { PassageDialog } from '@/playground/passage-dialog';
import { useAsk } from '@/playground/use-ask';
import { useCurrentWorkspace } from '@/workspaces/current';

/** How many passages the model is given. Leaving it out would use the workspace's own `topK`. */
const PASSAGE_COUNTS = [3, 5, 8];
const DEFAULT_PASSAGES = 5;

/** `/w/:slug/playground`: ask the workspace a question and watch the answer arrive. */
export function Playground() {
  const w = useCurrentWorkspace();
  // A fresh page per workspace, so one workspace's answer never shows under another's name.
  return <Ask key={w.slug} />;
}

function Ask() {
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
      <TopBar trail={[w.name, 'Playground']} />
      <div className="flex w-full max-w-290 flex-col gap-5 px-6 pt-7 pb-12">
        <div>
          <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">Playground</h1>
          <p className="text-muted-foreground text-sm">
            Try the same calls agents make. Everything here is logged like an API request.
          </p>
        </div>

        <div className="bg-card flex flex-col gap-3 rounded-xl border p-3.5">
          <label className="text-sm font-medium" htmlFor="question">
            Question
          </label>
          <textarea
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                // Otherwise the browser writes the newline into the box as well as submitting.
                e.preventDefault();
                submit();
              }
            }}
            placeholder="What is retrieval-augmented generation?"
            className="min-h-16 resize-y text-base leading-relaxed outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <select
              aria-label="Passages"
              className="border-input bg-background h-8 rounded-lg border px-2 text-[13px]"
              value={maxPassages}
              onChange={(e) => setMaxPassages(Number(e.target.value))}
            >
              {PASSAGE_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} passages
                </option>
              ))}
            </select>
            {streaming ? (
              <Button size="sm" variant="outline" onClick={ask.stop}>
                <SquareIcon /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={submit} disabled={!question.trim()}>
                <Sparkles /> Ask <span className="text-primary-foreground/60 font-mono text-xs">Ctrl ↵</span>
              </Button>
            )}
          </div>
        </div>

        {ask.error && ask.status === 'failed' && <Failure error={ask.error} onRetry={submit} />}

        {ask.answer?.grounded === false ? (
          <NotFound slug={w.slug} question={ask.question} />
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
                  {streaming && (
                    <span className="bg-foreground ml-0.5 inline-block h-4 w-1.5 animate-pulse" />
                  )}
                </p>
                {ask.status === 'stopped' && (
                  <p className="text-muted-foreground border-t pt-3 text-[13px]">
                    Stopped. What had arrived is above; the API still stored the whole answer.
                  </p>
                )}
              </div>
              {citations.length > 0 && <Sources citations={citations} onOpen={setOpenPassage} />}
            </div>
          )
        )}

        <PassageDialog slug={w.slug} passageId={openPassage} onClose={() => setOpenPassage(null)} />
      </div>
    </>
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
            <span className="text-muted-foreground font-mono text-xs">{c.score.toFixed(2)}</span>
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

/** Nothing in the workspace was relevant enough, so no model was called (`grounded: false`). */
function NotFound({ slug, question }: { slug: string; question: string }) {
  return (
    <div className="bg-card flex flex-wrap items-start gap-4 rounded-xl border p-7">
      <span className="bg-accent inline-flex size-10 flex-none items-center justify-center rounded-lg">
        <Search className="size-5" />
      </span>
      <div className="flex-[1_1_300px]">
        <h2 className="mb-1.5 text-[15px] font-semibold">Not found in this workspace</h2>
        <p className="text-muted-foreground mb-3.5 text-sm leading-relaxed">
          No passage was close enough to “{question}”, so no answer was generated. Upload material that covers
          it, or ask in the words the material uses.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/w/${slug}/upload`}>
            <Upload /> Upload material
          </Link>
        </Button>
      </div>
    </div>
  );
}
