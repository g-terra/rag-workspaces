import { ExternalLink, RefreshCw } from 'lucide-react';
import { useAuth } from '@/auth/auth-context';
import { ErrorState, Loading, Notice } from '@/components/states';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';
import { summarizeSystem, type HealthRow, type HealthState } from '@/system/health';
import { useSystem } from '@/system/queries';
import { toolLinks } from '@/system/tools';

const TOOLS = toolLinks({
  langflow: import.meta.env.VITE_LANGFLOW_URL ?? 'http://localhost:7860',
  keycloak: import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8081',
});

const GROUPS: { group: HealthRow['group']; title: string }[] = [
  { group: 'service', title: 'Services' },
  { group: 'provider', title: 'Model providers' },
  { group: 'model', title: 'Default models' },
];

const DOT: Record<HealthState, string> = {
  ok: 'bg-green-500',
  down: 'bg-red-500',
  off: 'bg-zinc-300',
};

/** `/system`: is the stack healthy, which version runs, and links to its own tools. Admins only. */
export function System() {
  const { me } = useAuth();
  const system = useSystem({ live: true, enabled: me?.isAdmin === true });

  if (!me) {
    return (
      <>
        <TopBar trail={['System']} />
        <Loading what="your account" />
      </>
    );
  }
  if (!me.isAdmin) {
    return (
      <>
        <TopBar trail={['System']} />
        <div className="px-6 py-7">
          <Notice
            title="Admins only"
            body="The system status shows every service and model provider behind the API, so only administrators can see it."
            alert
          />
        </div>
      </>
    );
  }

  const summary = system.data ? summarizeSystem(system.data) : null;

  return (
    <>
      <TopBar trail={['Admin', 'System']}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void system.refetch()}
          disabled={system.isFetching}
          aria-label="Refresh"
        >
          <RefreshCw className={cn(system.isFetching && 'animate-spin')} /> Refresh
        </Button>
      </TopBar>
      <div className="flex w-full max-w-290 flex-col gap-8 px-6 pt-7 pb-12">
        <div>
          <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">System</h1>
          <p className="text-muted-foreground text-sm" data-testid="versions">
            Admin UI v{APP_VERSION}
            {system.data && <> · API v{system.data.version}</>}
            {system.data && system.data.version !== APP_VERSION && (
              <span className="text-amber-700">
                {' '}
                · the versions differ: rebuild with docker compose up --build
              </span>
            )}
          </p>
        </div>

        <section aria-labelledby="health-title" className="flex flex-col gap-4">
          <h2 id="health-title" className="text-base font-semibold">
            Health
          </h2>
          {system.isPending && <Loading what="the system status" />}
          {system.isError && (
            <ErrorState
              title="Couldn't reach the API"
              error={system.error}
              onRetry={() => void system.refetch()}
            />
          )}
          {summary && (
            <>
              <p
                role="status"
                data-testid="health-summary"
                className={cn(
                  'rounded-lg border px-4 py-3 text-sm font-medium',
                  summary.problems === 0
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : 'border-red-200 bg-red-50 text-red-800',
                )}
              >
                {summary.problems === 0
                  ? 'All systems working'
                  : `${summary.problems} ${summary.problems === 1 ? 'problem' : 'problems'}`}
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                {GROUPS.map(({ group, title }) => (
                  <div key={group} className="rounded-xl border">
                    <h3 className="text-muted-foreground border-b px-4 py-2.5 text-xs font-medium">
                      {title}
                    </h3>
                    <ul className="divide-y">
                      {summary.rows
                        .filter((r) => r.group === group)
                        .map((r) => (
                          <li
                            key={r.name}
                            className="flex items-start gap-2.5 px-4 py-2.5"
                            data-testid="health-row"
                          >
                            <span
                              aria-hidden
                              className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[r.state])}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">{r.name}</span>
                              <span
                                className={cn(
                                  'block text-xs break-words',
                                  r.state === 'down' ? 'text-red-700' : 'text-muted-foreground',
                                )}
                              >
                                {r.detail}
                              </span>
                            </span>
                            <span className="sr-only">
                              {r.state === 'ok' ? 'working' : r.state === 'down' ? 'problem' : 'not set up'}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="tools-title" className="flex flex-col gap-4">
          <h2 id="tools-title" className="text-base font-semibold">
            Tools
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {TOOLS.map((t) => (
              <a
                key={t.name}
                href={t.href}
                target="_blank"
                rel="noreferrer"
                className="hover:bg-accent flex flex-col gap-1 rounded-xl border px-4 py-3"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {t.name} <ExternalLink className="text-muted-foreground size-3.5" />
                </span>
                <span className="text-muted-foreground text-xs">{t.description}</span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
