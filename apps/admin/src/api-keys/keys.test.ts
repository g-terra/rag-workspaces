import type { ApiKey } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import {
  curlExample,
  expiresAtFor,
  formatExpiry,
  keyState,
  validateCreate,
  validateEdit,
  type KeyForm,
} from './keys';

const now = new Date('2026-11-23T10:00:00.000Z');

function form(over: Partial<KeyForm> = {}): KeyForm {
  return {
    name: 'Claude agent',
    role: 'reader',
    workspaces: ['ouc'],
    expiry: 'never',
    customDate: '',
    ...over,
  };
}

function key(over: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key_1',
    name: 'Claude agent',
    prefix: 'rw_3Fa9',
    role: 'reader',
    workspaces: ['ouc'],
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...over,
  };
}

describe('expiresAtFor', () => {
  it('counts 30 and 90 days from now, and nothing for "never"', () => {
    expect(expiresAtFor(form({ expiry: 'never' }), now)).toBeNull();
    expect(expiresAtFor(form({ expiry: '30d' }), now)).toBe('2026-12-23T10:00:00.000Z');
    expect(expiresAtFor(form({ expiry: '90d' }), now)).toBe('2027-02-21T10:00:00.000Z');
  });

  it('ends a custom date at the end of that day, so the key lasts through it', () => {
    expect(expiresAtFor(form({ expiry: 'custom', customDate: '2026-12-31' }), now)).toBe(
      '2026-12-31T23:59:59.999Z',
    );
  });
});

describe('validateCreate', () => {
  it('builds the request body from a filled form', () => {
    const checked = validateCreate(
      form({ role: 'editor', workspaces: ['ouc', 'personal'], expiry: '30d' }),
      now,
    );
    expect(checked).toEqual({
      ok: true,
      body: {
        name: 'Claude agent',
        role: 'editor',
        workspaces: ['ouc', 'personal'],
        expiresAt: '2026-12-23T10:00:00.000Z',
      },
    });
  });

  it('asks for a name, a workspace and a date in words', () => {
    expect(validateCreate(form({ name: '  ' }), now)).toEqual({
      ok: false,
      errors: { name: 'Enter a name.' },
    });
    expect(validateCreate(form({ workspaces: [] }), now)).toEqual({
      ok: false,
      errors: { workspaces: 'Pick at least one workspace.' },
    });
    expect(validateCreate(form({ expiry: 'custom', customDate: '' }), now)).toEqual({
      ok: false,
      errors: { customDate: 'Pick a date.' },
    });
  });

  it('refuses an expiry date that has already passed', () => {
    expect(validateCreate(form({ expiry: 'custom', customDate: '2026-11-22' }), now)).toEqual({
      ok: false,
      errors: { customDate: 'Pick a date in the future.' },
    });
  });

  it('refuses a name over 100 characters', () => {
    const checked = validateCreate(form({ name: 'x'.repeat(101) }), now);
    expect(checked).toEqual({ ok: false, errors: { name: 'Use at most 100 characters.' } });
  });
});

describe('validateEdit', () => {
  it('sends only what changed, and never the role', () => {
    const edited = form({ name: 'Renamed', workspaces: ['ouc'] });
    expect(validateEdit(edited, key(), now)).toEqual({ ok: true, body: { name: 'Renamed' } });
    expect(validateEdit(form({ workspaces: ['ouc', 'personal'] }), key(), now)).toEqual({
      ok: true,
      body: { workspaces: ['ouc', 'personal'] },
    });
    expect(validateEdit(form({ expiry: '30d' }), key(), now)).toEqual({
      ok: true,
      body: { expiresAt: '2026-12-23T10:00:00.000Z' },
    });
  });

  it('clears the expiry when the key had one and "never" is picked', () => {
    const existing = key({ expiresAt: '2026-12-31T23:59:59.999Z' });
    expect(validateEdit(form({ expiry: 'never' }), existing, now)).toEqual({
      ok: true,
      body: { expiresAt: null },
    });
  });

  it('treats the day the key already expires on as no change', () => {
    const existing = key({ expiresAt: '2026-12-23T10:00:00.000Z' });
    const unchanged = form({ expiry: 'custom', customDate: '2026-12-23' });
    expect(validateEdit(unchanged, existing, now)).toEqual({
      ok: false,
      errors: { form: 'Nothing to change.' },
    });
  });

  it('says so when nothing was changed at all', () => {
    expect(validateEdit(form(), key(), now)).toEqual({ ok: false, errors: { form: 'Nothing to change.' } });
  });

  it('still refuses an empty name and a new expiry in the past', () => {
    expect(validateEdit(form({ name: '' }), key(), now)).toEqual({
      ok: false,
      errors: { name: 'Enter a name.' },
    });
    expect(validateEdit(form({ expiry: 'custom', customDate: '2026-11-01' }), key(), now)).toEqual({
      ok: false,
      errors: { customDate: 'Pick a date in the future.' },
    });
  });
});

describe('formatExpiry', () => {
  it('is "Never", "Expired" or the date', () => {
    expect(formatExpiry(key(), now)).toBe('Never');
    expect(formatExpiry(key({ expiresAt: '2026-11-22T10:00:00.000Z' }), now)).toBe('Expired');
    expect(formatExpiry(key({ expiresAt: '2026-12-31T23:59:59.999Z' }), now)).toBe('31 Dec 2026');
  });
});

describe('keyState', () => {
  it('is revoked, expired or active', () => {
    expect(keyState(key({ revokedAt: '2026-11-20T10:00:00.000Z' }), now)).toBe('revoked');
    expect(keyState(key({ expiresAt: '2026-11-22T10:00:00.000Z' }), now)).toBe('expired');
    expect(keyState(key({ expiresAt: '2026-12-01T10:00:00.000Z' }), now)).toBe('active');
    expect(keyState(key(), now)).toBe('active');
  });

  it('counts a revoked key as revoked even once it has expired', () => {
    const both = key({ revokedAt: '2026-11-20T10:00:00.000Z', expiresAt: '2026-11-21T10:00:00.000Z' });
    expect(keyState(both, now)).toBe('revoked');
  });
});

describe('curlExample', () => {
  it('asks the first bound workspace a question with the new secret', () => {
    const example = curlExample('http://localhost:18080', 'ouc', 'rw_7Hk2_secret');
    expect(example).toContain('http://localhost:18080/api/v1/workspaces/ouc/answers');
    expect(example).toContain('Authorization: Bearer rw_7Hk2_secret');
    expect(example).toContain('"question"');
  });
});
