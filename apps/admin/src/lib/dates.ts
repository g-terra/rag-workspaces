/** "just now", "5 min ago", "3 h ago" within a day; then "3 Nov", with the year if it isn't this one. */
export function formatRelative(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return then.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}
