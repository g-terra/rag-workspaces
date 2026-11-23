import type { ApiKey } from '@rag/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { formatExpiry, keyState } from '@/api-keys/keys';
import { useApiKeys } from '@/api-keys/queries';
import { useAuth } from '@/auth/auth-context';
import { CreateApiKeyDialog, EditApiKeyDialog, RevokeApiKeyDialog } from '@/components/api-key-dialogs';
import { ErrorState, Loading, Notice } from '@/components/states';
import { TopBar } from '@/components/top-bar';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/lib/dates';
import { cn } from '@/lib/utils';

const COLUMNS = ['Name', 'Key', 'Role', 'Workspaces', 'Last used', 'Expires'];

/** `/api-keys`: every key, with create, rename and revoke. Admins only, as the API is. */
export function ApiKeys() {
  const { me } = useAuth();
  const keys = useApiKeys(me?.isAdmin === true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  // `me` is still loading: say nothing rather than flash the admin page at someone who can't have it.
  if (!me) {
    return (
      <>
        <TopBar trail={['API keys']} />
        <Loading what="your account" />
      </>
    );
  }
  if (!me.isAdmin) {
    return (
      <>
        <TopBar trail={['API keys']} />
        <div className="px-6 py-7">
          <Notice
            title="Admins only"
            body="API keys reach every workspace they are bound to, so only administrators can see and create them."
            alert
          />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar trail={['Admin', 'API keys']}>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> Create key
        </Button>
      </TopBar>
      <div className="flex w-full max-w-290 flex-col gap-6 px-6 pt-7 pb-12">
        <div>
          <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="text-muted-foreground text-sm">
            For agents, scripts and anything else calling the API without signing in. Only admins create keys;
            each key only reaches the workspaces it is bound to.
          </p>
        </div>

        {keys.isPending && <Loading what="API keys" />}
        {keys.isError && (
          <ErrorState title="Couldn't load API keys" error={keys.error} onRetry={() => void keys.refetch()} />
        )}
        {keys.data?.length === 0 && (
          <Notice title="No API keys yet" body="Create one to let an agent or script use a workspace.">
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create key
            </Button>
          </Notice>
        )}
        {!!keys.data?.length && (
          <div className="bg-card overflow-x-auto rounded-xl border">
            <table aria-label="API keys" className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  {COLUMNS.map((head) => (
                    <th key={head} className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {head}
                    </th>
                  ))}
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.data.map((key) => {
                  const state = keyState(key);
                  return (
                    <tr key={key.id} data-testid="api-key-row" className="border-b last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{key.name}</span>
                        {state !== 'active' && <StatePill state={state} />}
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                        {key.prefix}••••
                      </td>
                      <td className="px-4 py-2.5">{key.role}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{key.workspaces.join(', ')}</td>
                      <td className="text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                        {key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'Never used'}
                      </td>
                      <td className="text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                        {formatExpiry(key)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {state !== 'revoked' && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => setEditing(key)}>
                              Edit
                            </Button>{' '}
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setRevoking(key)}
                            >
                              Revoke
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground text-[13px]">
          Secrets are stored hashed and shown once. A revoked key stops working immediately; its usage history
          stays in analytics.
        </p>
      </div>
      <CreateApiKeyDialog open={creating} onOpenChange={setCreating} />
      {editing && <EditApiKeyDialog apiKey={editing} onOpenChange={() => setEditing(null)} />}
      {revoking && <RevokeApiKeyDialog apiKey={revoking} onOpenChange={() => setRevoking(null)} />}
    </>
  );
}

function StatePill({ state }: { state: 'revoked' | 'expired' }) {
  return (
    <span
      className={cn(
        'ml-2 inline-flex h-5 items-center rounded-full px-2 text-xs font-medium',
        state === 'revoked' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800',
      )}
    >
      {state === 'revoked' ? 'Revoked' : 'Expired'}
    </span>
  );
}
