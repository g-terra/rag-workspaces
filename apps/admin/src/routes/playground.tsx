import { useSearchParams } from 'react-router';
import { TopBar } from '@/components/top-bar';
import { cn } from '@/lib/utils';
import { AskPanel } from '@/playground/ask-panel';
import { MODES, parseMode, type Mode } from '@/playground/search';
import { SearchPanel } from '@/playground/search-panel';
import { useCurrentWorkspace } from '@/workspaces/current';

/**
 * `/w/:slug/playground`: ask the workspace a question, or search its passages without a model. The
 * mode is in the URL (`?mode=search`), so a tab can be linked to and reloading keeps the one you chose.
 */
export function Playground() {
  const w = useCurrentWorkspace();
  const [params, setParams] = useSearchParams();
  const mode = parseMode(params.get('mode'));

  return (
    <>
      <TopBar trail={[w.name, 'Playground']} />
      <div className="flex w-full max-w-290 flex-col gap-5 px-6 pt-7 pb-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">Playground</h1>
            <p className="text-muted-foreground text-sm">
              Try the same calls agents make. Everything here is logged like an API request.
            </p>
          </div>
          <div role="tablist" aria-label="Mode" className="bg-muted flex rounded-lg p-0.5">
            {MODES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() =>
                  setParams(
                    (prev) => {
                      prev.set('mode', key);
                      return prev;
                    },
                    { replace: true },
                  )
                }
                className={cn(
                  'h-8 rounded-md px-3 text-sm',
                  mode === key ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* Both panels stay mounted, with the one you are not on hidden: looking at the passages
            while an answer streams must not abort it, and coming back shows it still there. Keyed by
            workspace, so switching workspace never shows one workspace's answer under another's
            name. A hidden panel is out of the accessibility tree, so nothing of it is reachable. */}
        <Panel key={w.slug} mode={mode} />
      </div>
    </>
  );
}

function Panel({ mode }: { mode: Mode }) {
  return (
    <>
      <div hidden={mode !== 'ask'} className="flex flex-col gap-5">
        <AskPanel />
      </div>
      <div hidden={mode !== 'search'} className="flex flex-col gap-5">
        <SearchPanel />
      </div>
    </>
  );
}
