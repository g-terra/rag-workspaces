import { CreateWorkspace } from '@rag/shared';
import { ApiError } from '@/api/client';

export interface CreateForm {
  name: string;
  slug: string;
  description: string;
}
type Field = keyof CreateForm;

export type Validated =
  { ok: true; body: CreateWorkspace } | { ok: false; errors: Partial<Record<Field, string>> };

/** Checks the dialog's fields with the API's own schema; settings are left to the defaults. */
export function validateCreate(form: CreateForm): Validated {
  const result = CreateWorkspace.safeParse({
    name: form.name,
    slug: form.slug,
    description: form.description.trim() || null,
  });
  if (result.success) return { ok: true, body: result.data };
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as Field;
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

/** The API's answer to `POST /v1/workspaces`, as a message under a field (`slug`) or on the whole form. */
export function createErrorMessage(err: unknown): { field: Field | null; message: string } {
  if (err instanceof ApiError && err.status === 409) return { field: 'slug', message: err.message };
  if (err instanceof ApiError && (err.status === 400 || err.status === 422)) {
    return { field: null, message: err.message };
  }
  const cause = err instanceof Error ? err.message : String(err);
  return { field: null, message: `Couldn't create the workspace: ${cause}` };
}
