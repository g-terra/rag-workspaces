const LAST_SLUG_KEY = 'rw.lastWorkspace';

/** Where `/` goes: the last used workspace if it still exists, else the first, else the list. */
export function landingPath(slugs: string[], lastSlug: string | null): string {
  const slug = lastSlug && slugs.includes(lastSlug) ? lastSlug : slugs[0];
  return slug ? `/w/${slug}` : '/workspaces';
}

// Storage can be blocked (private windows, site settings). The last slug is only a hint, so ignore that.
export function readLastSlug(): string | null {
  try {
    return localStorage.getItem(LAST_SLUG_KEY);
  } catch {
    return null;
  }
}

export function rememberSlug(slug: string): void {
  try {
    localStorage.setItem(LAST_SLUG_KEY, slug);
  } catch {
    // Nothing to do: `/` falls back to the first workspace.
  }
}
