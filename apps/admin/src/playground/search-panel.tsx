import { Search } from 'lucide-react';
import { useState } from 'react';
import { ErrorState, Loading, Notice } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SourceWorkspace } from './answer-view';
import { useCurrentWorkspace } from '@/workspaces/current';
import { passageWhere } from './answer';
import { PassageDialog } from './passage-dialog';
import { Passages, QuestionBox } from './question-box';
import { usePassageSearch } from './queries';
import { formatScore, searchPath, SEARCH_LIMITS } from './search';

/**
 * The playground's Search mode: the passages that best match a query, with their scores and no model
 * call, which is what an agent reads when it builds its own prompt.
 */
export function SearchPanel() {
  const w = useCurrentWorkspace();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(SEARCH_LIMITS[0]!);
  // The search that was asked for, so changing the count does not quietly run another one.
  const [submitted, setSubmitted] = useState<{ query: string; limit: number } | null>(null);
  const [openPassage, setOpenPassage] = useState<string | null>(null);
  const results = usePassageSearch(w.slug, submitted?.query ?? null, submitted?.limit ?? limit);
  const submit = () => {
    const text = query.trim();
    if (!text) return;
    // The same search again asks again, rather than doing nothing: the material, or the API's mood,
    // may have changed since.
    if (submitted?.query === text && submitted.limit === limit) void results.refetch();
    else setSubmitted({ query: text, limit });
  };

  return (
    <>
      <QuestionBox
        id="query"
        label="Search passages"
        placeholder="retrieval"
        value={query}
        onChange={setQuery}
        onSubmit={submit}
      >
        <Passages value={limit} onChange={setLimit} counts={SEARCH_LIMITS} />
        <Button size="sm" onClick={submit} disabled={!query.trim()}>
          <Search /> Search <span className="text-primary-foreground/60 font-mono text-xs">Ctrl ↵</span>
        </Button>
      </QuestionBox>

      {submitted !== null && (
        <div className="bg-card overflow-hidden rounded-xl border">
          <p className="text-muted-foreground border-b px-5 py-3 font-mono text-xs">
            GET {searchPath(w.slug, submitted.query, submitted.limit)} · no model call
          </p>
          {results.isPending && <Loading what="passages" />}
          {results.isError && (
            <div className="p-5">
              <ErrorState
                title="The search failed"
                error={results.error}
                onRetry={() => void results.refetch()}
              />
            </div>
          )}
          {results.data?.length === 0 && (
            <div className="p-5">
              <Notice
                title="Nothing matched"
                body={`No passage was close enough to “${submitted.query}”. The workspace's relevance threshold decides how close is close enough.`}
              />
            </div>
          )}
          {results.data?.map((hit) => (
            <div
              key={hit.id}
              data-testid="hit"
              className="flex w-full flex-wrap gap-4 border-b px-5 py-3.5 last:border-b-0"
            >
              <span className="w-12 font-mono text-sm font-medium">{formatScore(hit.score)}</span>
              <div className="flex-[1_1_300px]">
                {/* The place is the button, not the whole row: a row's text makes a poor button name. */}
                <button
                  type="button"
                  onClick={() => setOpenPassage(hit.id)}
                  className="text-[13px] font-semibold hover:underline"
                >
                  {passageWhere(hit)}
                </button>{' '}
                <SourceWorkspace slug={hit.workspace} />
                <p className="mt-1 line-clamp-3 text-sm leading-snug">{hit.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <PassageDialog slug={w.slug} passageId={openPassage} onClose={() => setOpenPassage(null)} />
    </>
  );
}
