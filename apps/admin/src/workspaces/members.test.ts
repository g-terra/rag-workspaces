import type { User, WorkspaceMember } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import {
  candidates,
  deleteErrorMessage,
  deleteIsConfirmed,
  directoryUnavailable,
  memberErrorMessage,
  memberRows,
  personLabel,
  personNote,
} from './members';

const member = (userId: string, over: Partial<WorkspaceMember> = {}): WorkspaceMember => ({
  userId,
  role: 'reader',
  grantedBy: 'admin-id',
  createdAt: '2026-11-12T09:00:00.000Z',
  ...over,
});

const user = (id: string, over: Partial<User> = {}): User => ({
  id,
  username: `user-${id}`,
  email: `${id}@example.test`,
  name: null,
  isAdmin: false,
  enabled: true,
  ...over,
});

describe('memberRows', () => {
  it('puts the person from the directory beside each granted role', () => {
    const rows = memberRows([member('u1', { role: 'editor' })], [user('u1', { name: 'Maria P.' })]);
    expect(rows).toEqual([
      {
        userId: 'u1',
        role: 'editor',
        grantedBy: 'admin-id',
        createdAt: '2026-11-12T09:00:00.000Z',
        person: user('u1', { name: 'Maria P.' }),
      },
    ]);
  });

  it('keeps a member the directory does not name, rather than dropping them', () => {
    const rows = memberRows([member('ghost')], [user('u1')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.person).toBeNull();
  });

  it('names nobody while the directory has not answered', () => {
    expect(memberRows([member('u1')], undefined)[0]!.person).toBeNull();
  });
});

describe('personLabel', () => {
  it('prefers the full name, then the username, then the raw id', () => {
    const rows = (p: User | null) => personLabel({ ...memberRows([member('u1')], undefined)[0]!, person: p });
    expect(rows(user('u1', { name: 'Maria P.' }))).toBe('Maria P.');
    expect(rows(user('u1'))).toBe('user-u1');
    expect(rows(null)).toBe('u1');
  });
});

describe('personNote', () => {
  it('shows the email and when access was granted', () => {
    const [row] = memberRows([member('u1')], [user('u1')]);
    expect(personNote(row!, true)).toBe('u1@example.test · added 12 Nov 2026');
  });

  it('says plainly when the directory was read and did not know the person', () => {
    const [row] = memberRows([member('ghost')], [user('u1')]);
    expect(personNote(row!, true)).toBe('not in the directory · added 12 Nov 2026');
  });

  it('accuses nobody of not existing when the directory was never read', () => {
    const [row] = memberRows([member('u1')], undefined);
    expect(personNote(row!, false)).toBe('added 12 Nov 2026');
  });

  it('marks an account that cannot sign in', () => {
    const [row] = memberRows([member('u1')], [user('u1', { enabled: false })]);
    expect(personNote(row!, true)).toContain('sign-in disabled');
  });
});

describe('candidates', () => {
  it('offers people who have no access yet', () => {
    expect(candidates([user('u1'), user('u2')], [member('u1')])).toEqual([
      { user: user('u1'), already: 'has access already' },
      { user: user('u2'), already: null },
    ]);
  });

  it('marks an admin, who reaches every workspace without being a member', () => {
    expect(candidates([user('a1', { isAdmin: true })], [])).toEqual([
      { user: user('a1', { isAdmin: true }), already: 'an admin, so already has access' },
    ]);
  });

  it('offers nothing while the directory has not answered', () => {
    expect(candidates(undefined, [])).toEqual([]);
  });
});

describe('directoryUnavailable', () => {
  it('is a 503: Keycloak is down or the people list is not set up', () => {
    expect(directoryUnavailable(new ApiError(503, 'not configured'))).toBe(true);
  });

  it('is not any other failure, which the page reports as itself', () => {
    expect(directoryUnavailable(new ApiError(403, 'forbidden'))).toBe(false);
    expect(directoryUnavailable(new Error('offline'))).toBe(false);
  });
});

describe('memberErrorMessage', () => {
  it('explains who may change access', () => {
    expect(memberErrorMessage(new ApiError(403, 'forbidden'))).toContain('admins');
  });

  it('passes a refused user id through', () => {
    expect(memberErrorMessage(new ApiError(400, 'userId: too short'))).toBe('userId: too short');
  });

  it('names the cause for anything else', () => {
    expect(memberErrorMessage(new Error('offline'))).toBe("Couldn't change access: offline");
  });
});

describe('deleteIsConfirmed', () => {
  it('needs the slug typed exactly, ignoring surrounding space', () => {
    expect(deleteIsConfirmed('  ouc ', 'ouc')).toBe(true);
    expect(deleteIsConfirmed('OUC', 'ouc')).toBe(false);
    expect(deleteIsConfirmed('ou', 'ouc')).toBe(false);
    expect(deleteIsConfirmed('', 'ouc')).toBe(false);
  });
});

describe('deleteErrorMessage', () => {
  it('explains who may delete a workspace', () => {
    expect(deleteErrorMessage(new ApiError(403, 'forbidden'))).toContain('admins');
  });

  it('says a workspace that is already gone is gone', () => {
    expect(deleteErrorMessage(new ApiError(404, 'No workspace'))).toContain('already');
  });

  it('names the cause for anything else', () => {
    expect(deleteErrorMessage(new Error('offline'))).toBe("Couldn't delete the workspace: offline");
  });
});
