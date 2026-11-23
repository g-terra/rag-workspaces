import { Search, Sparkles, SquareIcon, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Notice } from '@/components/states';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { answerMeta } from '@/playground/answer';
import { useAsk } from '@/playground/use-ask';
import { useCurrentWorkspace } from '@/workspaces/current';

/** How many passages the model is given. Leaving it out would use the workspace's own `topK`. */
const PASSAGE_COUNTS = [5, 3, 8];

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
  const [maxPassages, setMaxPassages] = useState(PASSAGE_COUNTS[0]!);
  const streaming = ask.status === 'streaming';
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
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
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

        {ask.status === 'failed' && (
          <Notice title="The answer failed" body={ask.error!} alert>
            <Button variant="outline" size="sm" onClick={submit} disabled={!question.trim()}>
              Try again
            </Button>
          </Notice>
        )}

        {ask.answer?.grounded === false ? (
          <NotFound slug={w.slug} question={ask.question} />
        ) : (
          (streaming || ask.text !== '' || ask.status === 'stopped') && (
            <div className="bg-card flex flex-col gap-4 rounded-xl border p-5">
              {ask.answer && (
                <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
                  <span className="font-mono">{ask.answer.id}</span>
                  <span data-testid="answer-meta">{answerMeta(ask.answer)}</span>
                </div>
              )}
              <p data-testid="answer" className="text-[15px] leading-relaxed whitespace-pre-wrap">
                {ask.text}
                {streaming && <span className="bg-foreground ml-0.5 inline-block h-4 w-1.5 animate-pulse" />}
              </p>
              {ask.status === 'stopped' && (
                <p className="text-muted-foreground border-t pt-3 text-[13px]">
                  Stopped. What had arrived is above; the API still stored the whole answer.
                </p>
              )}
            </div>
          )
        )}
      </div>
    </>
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
