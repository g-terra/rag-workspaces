import type { ProviderStatus } from '@rag/shared';
import type { ReactNode } from 'react';
import { useAuth } from '@/auth/auth-context';
import { ErrorState, Loading, Notice } from '@/components/states';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { useSystem } from '@/system/queries';
import {
  firstProblem,
  langflowKeyNote,
  latencyNote,
  providerDetail,
  providerLabel,
  serviceLabel,
} from '@/system/status';

/** `/system`: the detail behind the banner — what is up, what is down, and which models are there. */
export function System() {
  const { me } = useAuth();
  if (!me) return <Loading what="your account" />;
  if (!me.isAdmin) {
    return (
      <>
        <TopBar trail={['System']} />
        <div className="px-6 py-7">
          <Notice
            title="Admins only"
            body="The services and model providers behind the API are shown to admins."
            alert
          />
        </div>
      </>
    );
  }
  return <SystemPage />;
}

function SystemPage() {
  const system = useSystem();
  const problem = system.data ? firstProblem(system.data) : null;

  return (
    <>
      <TopBar trail={['System']}>
        <Button
          variant="outline"
          size="sm"
          disabled={system.isFetching}
          onClick={() => void system.refetch()}
        >
          {system.isFetching ? 'Checking…' : 'Check again'}
        </Button>
      </TopBar>

      <div className="flex w-full max-w-[1160px] flex-col gap-5 px-6 pt-7 pb-12">
        <div>
          <h1 className="text-xl font-semibold">System</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            What the API checks for <code className="text-xs">GET /ready</code>, asked again each time this
            page loads.
          </p>
        </div>

        {system.isPending && <Loading what="the system status" />}
        {system.isError && (
          <ErrorState
            title="Couldn't read the system status"
            error={system.error}
            onRetry={() => void system.refetch()}
          />
        )}

        {system.data && (
          <>
            {problem ? (
              <div
                role="alert"
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
              >
                <p className="font-medium">{problem.what}.</p>
                <p className="mt-1">{problem.fix}</p>
              </div>
            ) : (
              <p role="status" className="text-muted-foreground text-sm">
                Everything the API depends on answered, and both default models are available.
              </p>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Services" note="Each one as GET /ready checks it.">
                <ul>
                  {system.data.services.map((s) => (
                    <Row key={s.name} name={serviceLabel(s.name)} detail={latencyNote(s)} ok={s.ok} />
                  ))}
                  <Row
                    name="Langflow key"
                    detail={langflowKeyNote(system.data.langflowKey)}
                    ok={system.data.langflowKey !== 'none'}
                  />
                </ul>
              </Card>

              <Card title="Model providers" note="Asked with the keys in .env; keys are never returned.">
                <ul>
                  {system.data.providers.map((p) => (
                    <Row
                      key={p.id}
                      name={providerLabel(p.id)}
                      detail={providerDetail(p)}
                      ok={p.configured && p.reachable === true}
                      label={providerState(p)}
                    />
                  ))}
                </ul>
                <dl className="text-muted-foreground mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
                  <dt>Default chat</dt>
                  <dd className="text-foreground">
                    {providerLabel(system.data.defaults.chat.provider)} / {system.data.defaults.chat.model}
                    {system.data.defaults.chat.available ? '' : ' — not available'}
                  </dd>
                  <dt>Default embedding</dt>
                  <dd className="text-foreground">
                    {providerLabel(system.data.defaults.embedding.provider)} /{' '}
                    {system.data.defaults.embedding.model}
                    {system.data.defaults.embedding.available ? '' : ' — not available'}
                  </dd>
                  <dt>API version</dt>
                  <dd className="text-foreground font-mono">{system.data.version}</dd>
                </dl>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** A provider is three states, not two: no key set, a key that didn't work, and working. */
function providerState(p: ProviderStatus): string {
  if (!p.configured) return 'No key';
  if (p.reachable === false) return 'Down';
  return 'Ready';
}

function Card({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-0.5 mb-3 text-[13px]">{note}</p>
      {children}
    </section>
  );
}

function Row({ name, detail, ok, label }: { name: string; detail: string; ok: boolean; label?: string }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b py-2 last:border-b-0">
      <span className="min-w-0 flex-[999_1_160px]">
        <span className="block text-sm font-medium">{name}</span>
        <span className="text-muted-foreground block truncate text-xs" title={detail}>
          {detail}
        </span>
      </span>
      {/* The word carries the state, not the colour alone. */}
      <span
        className={
          ok
            ? 'inline-flex h-5.5 items-center rounded-full bg-green-100 px-2 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200'
            : 'inline-flex h-5.5 items-center rounded-full bg-red-100 px-2 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200'
        }
      >
        {label ?? (ok ? 'Ready' : 'Down')}
      </span>
    </li>
  );
}
