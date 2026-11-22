/**
 * The path to go back to after signing in. Only paths on this site are allowed, so a crafted
 * `?returnTo=` link can't send someone to another site after they sign in.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
