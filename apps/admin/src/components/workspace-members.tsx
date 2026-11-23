import type { Workspace, WorkspaceRole } from '@rag/shared';
import { useState } from 'react';
import { Field } from '@/components/field';
import { ErrorState, Loading } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGrantMember, useMembers, useRemoveMember, useUsers } from '@/workspaces/member-queries';
import {
  candidates,
  directoryUnavailable,
  MEMBER_ROLES,
  memberErrorMessage,
  memberRows,
  personLabel,
  personNote,
} from '@/workspaces/members';

const selectClass =
  'border-input dark:bg-input/30 h-8 rounded-md border bg-transparent px-2 text-[13px] shadow-xs';

/**
 * Who has been granted access to this workspace, and how to grant or remove it. Accounts
 * themselves are made in Keycloak's console (decision 12); this screen only grants.
 */
export function WorkspaceMembers({ workspace }: { workspace: Workspace }) {
  const members = useMembers(workspace.slug);
  // Named from the directory. A failure here is not fatal: the rows fall back to raw ids.
  const directory = useUsers('');
  const grant = useGrantMember(workspace.slug);
  const remove = useRemoveMember(workspace.slug);

  if (members.isPending) return <Loading what="the members" />;
  if (members.isError) {
    return (
      <ErrorState
        title="Couldn't load the members"
        error={members.error}
        onRetry={() => void members.refetch()}
      />
    );
  }

  const rows = memberRows(members.data, directory.data);
  const failure = grant.error ?? remove.error;

  return (
    <>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nobody has been granted access yet. Admins reach every workspace without being listed here.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.userId}
              className="flex flex-wrap items-center gap-3 border-b py-2.5 last:border-b-0"
            >
              <span
                aria-hidden
                className="bg-muted inline-flex size-7 flex-none items-center justify-center rounded-full text-[13px] font-semibold"
              >
                {personLabel(row).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-[999_1_200px]">
                <span className="block truncate text-sm font-medium" title={row.userId}>
                  {personLabel(row)}
                </span>
                <span className="text-muted-foreground block truncate text-xs">{personNote(row)}</span>
              </span>
              <select
                aria-label={`Role for ${personLabel(row)}`}
                className={selectClass}
                value={row.role}
                disabled={grant.isPending || remove.isPending}
                onChange={(e) => grant.mutate({ userId: row.userId, role: e.target.value as WorkspaceRole })}
              >
                {MEMBER_ROLES.map(({ role }) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate(row.userId)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {failure && (
        <p role="alert" className="text-destructive text-sm">
          {memberErrorMessage(failure)}
        </p>
      )}

      <GrantAccess workspace={workspace} members={members.data} />

      <p className="text-muted-foreground text-xs">
        {MEMBER_ROLES.map((r) => `${r.role}: ${r.can}`).join(' · ')} · admins see every workspace.
      </p>
    </>
  );
}

/** The picker, or a plain user id field when `/v1/users` cannot be read. */
function GrantAccess({
  workspace,
  members,
}: {
  workspace: Workspace;
  members: Parameters<typeof candidates>[1];
}) {
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('reader');
  const found = useUsers(search.trim());
  const grant = useGrantMember(workspace.slug);
  // 503 is "Keycloak is down, or its people list was never set up" — the one case a person still
  // has to be granted by raw id, which is what the API has always accepted.
  const byId = directoryUnavailable(found.error);
  const people = candidates(found.data, members);
  const chosen = people.find((c) => c.user.id === userId);
  const blocked = byId ? userId.trim() === '' : !chosen || chosen.already !== null;

  const submit = () =>
    grant.mutate(
      { userId: userId.trim(), role },
      {
        onSuccess: () => {
          setUserId('');
          setSearch('');
        },
      },
    );

  const roleAndGrant = (
    <>
      <select
        aria-label="Role to grant"
        className="border-input dark:bg-input/30 h-9 flex-[1_1_120px] rounded-md border bg-transparent px-2.5 text-sm shadow-xs"
        value={role}
        onChange={(e) => setRole(e.target.value as WorkspaceRole)}
      >
        {MEMBER_ROLES.map(({ role: r }) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <Button disabled={blocked || grant.isPending} onClick={submit}>
        {grant.isPending ? 'Granting…' : 'Grant access'}
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      {byId ? (
        // The people list is unavailable: granting by raw id is what the API has always accepted.
        <>
          <Field
            id="grant-user-id"
            label="Keycloak user id"
            hint="The people list isn't available, so paste the id from Keycloak's console."
          >
            <Input
              id="grant-user-id"
              aria-describedby="grant-user-id-note"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">{roleAndGrant}</div>
        </>
      ) : (
        <>
          <Field
            id="grant-search"
            label="Person"
            hint={
              found.isError
                ? `Couldn't search people: ${found.error.message}`
                : 'Search by name, username or email.'
            }
          >
            <Input
              id="grant-search"
              aria-describedby="grant-search-note"
              value={search}
              placeholder="Search Keycloak…"
              onChange={(e) => {
                setSearch(e.target.value);
                setUserId('');
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Person to grant"
              className="border-input dark:bg-input/30 h-9 flex-[999_1_220px] rounded-md border bg-transparent px-2.5 text-sm shadow-xs"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">
                {found.isPending ? 'Looking…' : `Choose a person (${people.length} found)…`}
              </option>
              {people.map((c) => (
                <option key={c.user.id} value={c.user.id} disabled={c.already !== null}>
                  {c.user.name ?? c.user.username}
                  {c.already ? ` — ${c.already}` : ''}
                </option>
              ))}
            </select>
            {roleAndGrant}
          </div>
        </>
      )}
      {grant.error && (
        <p role="alert" className="text-destructive text-sm">
          {memberErrorMessage(grant.error)}
        </p>
      )}
    </div>
  );
}
