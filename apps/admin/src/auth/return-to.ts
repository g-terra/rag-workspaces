/**
 * The path to go back to after signing in. Only paths on this site are allowed, so a crafted
 * `?returnTo=` link can't send someone to another site after they sign in. The value is resolved the
 * way a browser would (which drops tabs and newlines, so `/\t/evil.example` means `//evil.example`)
 * and kept only if it stays on this origin.
 */
export function safeReturnTo(value: string | null | undefined, origin = 'https://admin.invalid'): string {
  if (!value?.startsWith('/')) return '/';
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return '/';
  }
  return url.origin === origin ? url.pathname + url.search + url.hash : '/';
}
