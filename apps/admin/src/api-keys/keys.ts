import { CreateApiKey, UpdateApiKey, type ApiKey, type WorkspaceRole } from '@rag/shared';

/** The expiry choices from the approved mock. */
export type ExpiryChoice = 'never' | '30d' | '90d' | 'custom';

export interface KeyForm {
  name: string;
  role: WorkspaceRole;
  workspaces: string[];
  expiry: ExpiryChoice;
  /** `yyyy-mm-dd` from the date input, used only when `expiry` is `custom`. */
  customDate: string;
}

type Field = 'name' | 'workspaces' | 'customDate' | 'form';
export type Errors = Partial<Record<Field, string>>;
export type Checked<T> = { ok: true; body: T } | { ok: false; errors: Errors };

const DAY = 24 * 60 * 60 * 1000;

/**
 * When the key stops working, as the API wants it, or `null` for "never". A custom date ends at the
 * end of that day in UTC, so a key dated "31 Dec" still works all of 31 December.
 */
export function expiresAtFor(form: KeyForm, now = new Date()): string | null {
  if (form.expiry === 'never') return null;
  if (form.expiry === 'custom') {
    return form.customDate ? `${form.customDate}T23:59:59.999Z` : null;
  }
  const days = form.expiry === '30d' ? 30 : 90;
  return new Date(now.getTime() + days * DAY).toISOString();
}

/** The chosen expiry, or why it can't be used. */
function checkExpiry(form: KeyForm, now: Date): Errors | null {
  if (form.expiry !== 'custom') return null;
  if (!form.customDate) return { customDate: 'Pick a date.' };
  const at = new Date(`${form.customDate}T23:59:59.999Z`);
  if (Number.isNaN(at.getTime())) return { customDate: 'Pick a date.' };
  if (at.getTime() <= now.getTime()) return { customDate: 'Pick a date in the future.' };
  return null;
}

/** The dialog's fields as `POST /v1/api-keys` wants them, or messages under the fields. */
export function validateCreate(form: KeyForm, now = new Date()): Checked<CreateApiKey> {
  const expiry = checkExpiry(form, now);
  if (expiry) return { ok: false, errors: expiry };
  const result = CreateApiKey.safeParse({
    name: form.name,
    role: form.role,
    workspaces: form.workspaces,
    expiresAt: expiresAtFor(form, now),
  });
  if (result.success) return { ok: true, body: result.data };
  return { ok: false, errors: messages(result.error.issues) };
}

/**
 * The fields that differ from the key, as `PATCH /v1/api-keys/{id}` wants them. The role is never
 * sent: the API answers 400, since a key must not gain rights silently. Picking the day the key
 * already expires on counts as no change, so saving a new name doesn't move the expiry by a few hours.
 */
export function validateEdit(form: KeyForm, key: ApiKey, now = new Date()): Checked<UpdateApiKey> {
  const sameDay = form.expiry === 'custom' && form.customDate === key.expiresAt?.slice(0, 10);
  const expiresAt = sameDay ? key.expiresAt : expiresAtFor(form, now);
  if (expiresAt !== key.expiresAt) {
    const expiry = checkExpiry(form, now);
    if (expiry) return { ok: false, errors: expiry };
  }
  const body: UpdateApiKey = {};
  if (form.name.trim() !== key.name) body.name = form.name;
  if (!sameWorkspaces(form.workspaces, key.workspaces)) body.workspaces = form.workspaces;
  if (expiresAt !== key.expiresAt) body.expiresAt = expiresAt;
  const result = UpdateApiKey.safeParse(body);
  if (!result.success) return { ok: false, errors: messages(result.error.issues) };
  if (!Object.keys(result.data).length) return { ok: false, errors: { form: 'Nothing to change.' } };
  return { ok: true, body: result.data };
}

function sameWorkspaces(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((slug, i) => slug === sorted[i]);
}

/** zod's own messages ("Too small: expected string to have >=1 characters") in words a person reads. */
function messages(
  issues: { code: string; path: PropertyKey[]; message: string; maximum?: unknown }[],
): Errors {
  const errors: Errors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (field === 'name') {
      errors.name ??=
        issue.code === 'too_big' ? `Use at most ${String(issue.maximum)} characters.` : 'Enter a name.';
    } else if (field === 'workspaces') {
      errors.workspaces ??= 'Pick at least one workspace.';
    } else {
      errors.form ??= issue.message;
    }
  }
  return errors;
}

/** "Never", "Expired", or "31 Dec 2026". */
export function formatExpiry(key: ApiKey, now = new Date()): string {
  if (!key.expiresAt) return 'Never';
  const at = new Date(key.expiresAt);
  if (at.getTime() <= now.getTime()) return 'Expired';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whether the key still works. A revoked key stays listed, so usage history keeps its name. */
export function keyState(key: ApiKey, now = new Date()): 'revoked' | 'expired' | 'active' {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

/**
 * A ready-to-run request with the new secret. The UI's own origin is used because that is a URL the
 * admin is already talking to: nginx (or Vite) forwards `/api` to the API.
 */
export function curlExample(origin: string, workspace: string, secret: string): string {
  return `curl ${origin}/api/v1/workspaces/${workspace}/answers \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  -d '{"question":"What is in this workspace?"}'`;
}
