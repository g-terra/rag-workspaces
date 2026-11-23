/** The time ranges from the approved mock. The page opens on the last 7 days. */
export type RangeKey = '24h' | '7d' | '14d' | '30d';

export const RANGES: [RangeKey, string][] = [
  ['24h', '24 hours'],
  ['7d', '7 days'],
  ['14d', '14 days'],
  ['30d', '30 days'],
];

const HOUR = 60 * 60 * 1000;
const HOURS: Record<RangeKey, number> = { '24h': 24, '7d': 7 * 24, '14d': 14 * 24, '30d': 30 * 24 };

/** `from` and `to` for the usage routes, which default to the last 7 days when they are left out. */
export function rangeFor(key: RangeKey, now = new Date()): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - HOURS[key] * HOUR).toISOString(),
    to: now.toISOString(),
  };
}

/** A day of traffic is worth seeing hour by hour; a month would be 720 bars. */
export function intervalFor(key: RangeKey): 'hour' | 'day' {
  return key === '24h' ? 'hour' : 'day';
}

export function formatCount(n: number): string {
  return n.toLocaleString('en');
}

/** "84 ms", "1.8 s", or "–" when the range holds no requests to measure. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** The API sends a rate (0 to 1); whole percents read better than "1.23%". */
export function formatPercent(rate: number): string {
  const percent = rate * 100;
  return `${percent > 0 && percent < 100 ? percent.toFixed(1) : String(Math.round(percent))}%`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)} k`;
  return formatCount(n);
}

/** Which colour a status code wears: ours, theirs, or fine. */
export function statusTone(code: number): 'ok' | 'client' | 'server' {
  if (code >= 500) return 'server';
  if (code >= 400) return 'client';
  return 'ok';
}

/** The bucket as the axis shows it. UTC, because the API buckets in UTC. */
export function bucketLabel(iso: string, interval: 'hour' | 'day'): string {
  const at = new Date(iso);
  if (interval === 'hour') {
    return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  }
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
