import { CreateWorkspace, type Workspace } from '@rag/shared';

/**
 * Composite workspaces hold no documents: they answer from two to ten standard workspaces, their
 * sources (docs/api-schema.md, Composite workspaces).
 */

export interface CompositeForm {
  name: string;
  slug: string;
  description: string;
  sources: string[];
}
type Field = 'name' | 'slug' | 'description' | 'sources';

export type ValidatedComposite =
  { ok: true; body: CreateWorkspace } | { ok: false; errors: Partial<Record<Field, string>> };

/** The workspaces a composite can draw on: standard ones only (no composites of composites), by name. */
export function sourceChoices(workspaces: Workspace[]): Workspace[] {
  return workspaces.filter((w) => w.kind === 'standard').sort((a, b) => a.name.localeCompare(b.name));
}

/** What's wrong with a list of sources, or `null`. The API asks for two to ten. */
export function sourcesError(sources: string[]): string | null {
  if (sources.length < 2) return 'Pick at least two workspaces.';
  if (sources.length > 10) return 'Pick at most ten workspaces.';
  return null;
}

/** The create dialog's fields checked with the API's own schema, as the body for `POST /v1/workspaces`. */
export function validateComposite(form: CompositeForm): ValidatedComposite {
  const errors: Partial<Record<Field, string>> = {};
  const sources = sourcesError(form.sources);
  if (sources) errors.sources = sources;
  const result = CreateWorkspace.safeParse({
    name: form.name,
    slug: form.slug,
    description: form.description.trim() || null,
    kind: 'composite',
    sources: form.sources,
  });
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as Field;
      if (field === 'sources') continue;
      const empty = field !== 'description' && form[field].trim() === '';
      errors[field] ??= empty ? `Enter a ${field}.` : issue.message;
    }
  }
  if (Object.keys(errors).length || !result.success) return { ok: false, errors };
  return { ok: true, body: result.data };
}

/**
 * The name to show next to a passage or citation found through a composite: its source workspace's
 * name (its slug when the caller can't open it). `null` when it comes from the workspace being asked.
 */
export function sourceLabel(passageWorkspace: string, asked: string, workspaces: Workspace[]): string | null {
  if (passageWorkspace === asked) return null;
  return workspaces.find((w) => w.slug === passageWorkspace)?.name ?? passageWorkspace;
}

/**
 * Where a passage's document can be opened (library, PDF preview): the workspace that holds it, which
 * for a passage found through a composite is one of its sources. `null` when the caller can't open that
 * workspace itself, so there is no document page to offer.
 */
export function documentHome(passageWorkspace: string, workspaces: Workspace[]): string | null {
  return workspaces.some((w) => w.slug === passageWorkspace && w.kind === 'standard')
    ? passageWorkspace
    : null;
}
