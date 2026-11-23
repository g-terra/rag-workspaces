import { TopBar } from '@/components/top-bar';
import { WorkspaceAvatar } from '@/components/workspace-avatar';
import { useCurrentWorkspace } from '@/workspaces/current';

/** A workspace's home: what it is and where its API lives. The dashboard replaces it later in M4. */
export function WorkspaceHome() {
  const w = useCurrentWorkspace();
  const facts: [string, string][] = [
    ['Slug', w.slug],
    ['API', `/v1/workspaces/${w.slug}`],
    ['Status', w.status],
    ['Your access', w.access],
  ];
  return (
    <>
      <TopBar trail={[w.name, 'Overview']} />
      <div className="flex w-full max-w-290 flex-col gap-6 px-6 pt-7 pb-12">
        <div className="flex items-start gap-3">
          <WorkspaceAvatar name={w.name} slug={w.slug} className="size-10 text-base" />
          <div>
            <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">{w.name}</h1>
            <p className="text-muted-foreground text-sm">{w.description ?? 'No description.'}</p>
          </div>
        </div>
        <dl className="bg-card grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 rounded-xl border p-5 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className={label === 'Slug' || label === 'API' ? 'font-mono text-xs leading-5' : undefined}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
