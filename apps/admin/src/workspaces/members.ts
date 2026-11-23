import type { User, WorkspaceMember, WorkspaceRole } from '@rag/shared';
import { ApiError } from '@/api/client';

/** A granted role with whoever `GET /v1/users` says the user id belongs to. */
export interface MemberRow extends WorkspaceMember {
  /** `null` when the directory has not answered, or does not know this id. */
  person: User | null;
}

/**
 * The workspace's members, each matched to a person. A member the directory cannot name is kept:
 * the grant is real whatever Keycloak says, and hiding the row would hide the access.
 */
export function memberRows(members: WorkspaceMember[], people: User[] | undefined): MemberRow[] {
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  return members.map((m) => ({ ...m, person: byId.get(m.userId) ?? null }));
}

/** What to call a person: their name, else the username, else the bare id. */
export function personLabel(row: MemberRow): string {
  return row.person?.name ?? row.person?.username ?? row.userId;
}

/**
 * The line under the name: how to recognise them, and when they were given access.
 *
 * `directoryRead` is whether `GET /v1/users` actually answered. Without it a row has no person for
 * three different reasons, and only one of them is "Keycloak doesn't know this id" — saying so while
 * the list is still loading, or while it is answering 503, would accuse every real account on the
 * page of not existing.
 */
export function personNote(row: MemberRow, directoryRead: boolean): string {
  const parts: string[] = [];
  if (row.person) parts.push(row.person.email ?? row.person.username);
  else if (directoryRead) parts.push('not in the directory');
  if (row.person && !row.person.enabled) parts.push('sign-in disabled');
  parts.push(`added ${day(row.createdAt)}`);
  return parts.join(' · ');
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Someone the picker can offer, and why granting them a role would change nothing. */
export interface Candidate {
  user: User;
  already: string | null;
}

/**
 * The people found, each marked when a grant would be pointless rather than hidden: an admin
 * reaches every workspace without being a member, and someone already listed is already in.
 * Showing them disabled answers "why isn't X in the list?" where leaving them out would not.
 */
export function candidates(people: User[] | undefined, members: WorkspaceMember[]): Candidate[] {
  const has = new Set(members.map((m) => m.userId));
  return (people ?? []).map((user) => ({
    user,
    already: user.isAdmin
      ? 'an admin, so already has access'
      : has.has(user.id)
        ? 'has access already'
        : null,
  }));
}

/**
 * `GET /v1/users` answers 503 when Keycloak cannot be reached or its people list is not set up
 * (no `KEYCLOAK_DIRECTORY_SECRET`). That is the case the page falls back to a plain id field for.
 */
export function directoryUnavailable(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

/** The API's answer to a `PUT` or `DELETE` on a member, in words. */
export function memberErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'Only admins can change who has access.';
  if (err instanceof ApiError && (err.status === 400 || err.status === 404 || err.status === 422)) {
    return err.message;
  }
  const cause = err instanceof Error ? err.message : String(err);
  return `Couldn't change access: ${cause}`;
}

/** Deleting takes the slug typed out: it is the one thing on the page that cannot be undone. */
export function deleteIsConfirmed(typed: string, slug: string): boolean {
  return typed.trim() === slug;
}

export function deleteErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'Only admins can delete a workspace.';
  if (err instanceof ApiError && err.status === 404) return 'This workspace is already gone.';
  const cause = err instanceof Error ? err.message : String(err);
  return `Couldn't delete the workspace: ${cause}`;
}

/** The roles a member can hold. `admin` is global, never granted here. */
export const MEMBER_ROLES: { role: WorkspaceRole; can: string }[] = [
  { role: 'reader', can: 'ask, chat, search' },
  { role: 'editor', can: 'also upload, delete and reindex' },
];
