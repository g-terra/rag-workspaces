import type { Workspace, WorkspaceMember, WorkspaceRole } from '@rag/shared';
import { useEffect, useState } from 'react';
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
const wideSelectClass =
  'border-input dark:bg-input/30 h-9 rounded-md border bg-transparent px-2.5 text-sm shadow-xs';

/** Keystrokes are cheap here but a search is not: each one asks Keycloak for every match's roles. */
function useDebounced(value: string, ms = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Who has been granted access to this workspace, and how to grant or remove it. Accounts
 * themselves are made in Keycloak's console (decision 12); this screen only grants.
 */
export function WorkspaceMembers({ workspace }: { workspace: Workspace }) {
  // The search lives here, not in the picker, because the people it finds also name the rows: the
  // person just granted is not in the unfiltered first page, and would come back as a bare id.
  const [search, setSearch] = useState('');
  const members = useMembers(workspace.slug);
  const directory = useUsers('');
  const found = useUsers(useDebounced(search.trim()));
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

  const people = [...(directory.data ?? []), ...(found.data ?? [])];
  const rows = memberRows(members.data, people);
  // Only a directory that actually answered can say an id is unknown to it.
  const directoryRead = directory.isSuccess;
  const busy = grant.isPending || remove.isPending;
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
                <span className="text-muted-foreground block truncate text-xs">
                  {personNote(row, directoryRead)}
                </span>
              </span>
              <select
                aria-label={`Role for ${personLabel(row)}`}
                className={selectClass}
                value={row.role}
                disabled={busy}
                onChange={(e) => {
                  remove.reset();
                  grant.mutate({ userId: row.userId, role: e.target.value as WorkspaceRole });
                }}
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
                // Also while a role change is in flight: `PUT` upserts, so a DELETE that commits
                // first would be undone by it and leave the person with access and no error.
                disabled={busy}
                onClick={() => {
                  grant.reset();
                  remove.mutate(row.userId);
                }}
              >
                Remove<span className="sr-only"> {personLabel(row)}</span>
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

      <GrantAccess
        workspace={workspace}
        members={members.data}
        found={found}
        search={search}
        onSearch={setSearch}
      />

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
  found,
  search,
  onSearch,
}: {
  workspace: Workspace;
  members: WorkspaceMember[];
  found: ReturnType<typeof useUsers>;
  search: string;
  onSearch(value: string): void;
}) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('reader');
  const grant = useGrantMember(workspace.slug);
  // 503 is "Keycloak is down, or its people list was never set up" — the one case a person still
  // has to be granted by raw id, which is what the API has always accepted. Anything else is a real
  // failure and is shown as one.
  const byId = directoryUnavailable(found.error);
  const people = candidates(found.data, members);
  const addable = people.filter((c) => c.already === null).length;
  const chosen = people.find((c) => c.user.id === userId);
  const blocked = byId ? userId.trim() === '' : !chosen || chosen.already !== null;

  const submit = () =>
    grant.mutate(
      { userId: userId.trim(), role },
      {
        onSuccess: () => {
          setUserId('');
          onSearch('');
        },
      },
    );

  const roleAndGrant = (
    <>
      <select
        aria-label="Role to grant"
        className={`${wideSelectClass} flex-[1_1_120px]`}
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
                onSearch(e.target.value);
                setUserId('');
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Person to grant"
              className={`${wideSelectClass} flex-[999_1_220px]`}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">{pickerPrompt(found.isPending, addable, people.length)}</option>
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

/** How many of the matches can actually be added, which is not how many were found. */
function pickerPrompt(loading: boolean, addable: number, total: number): string {
  if (loading) return 'Looking…';
  if (total === 0) return 'Nobody found';
  if (addable === 0) return `Choose a person (all ${total} found already have access)…`;
  return `Choose a person (${addable} of ${total} found can be added)…`;
}
