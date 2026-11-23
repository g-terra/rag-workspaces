import type { TimeseriesPoint } from '@rag/shared';

/**
 * Chart geometry, kept away from the markup so it can be tested without a browser. Bars are laid out
 * in percentages (the column divs stretch with the card); the line is drawn in a 0–100 box that the
 * SVG stretches, so both are free of pixel widths.
 */

/** The top of the axis: 1, 2 or 5 times a power of ten, so the ticks are round numbers. */
export function niceMax(values: number[]): number {
  const top = Math.max(0, ...values);
  if (top <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(top));
  const step = [1, 2, 5, 10].find((s) => top <= s * magnitude) ?? 10;
  return step * magnitude;
}

/** Each value as a percentage of the axis top, so a column div can use it as its height. */
export function barHeights(values: number[], max: number): number[] {
  return values.map((v) => (max > 0 ? (v / max) * 100 : 0));
}

/** The labels down the y axis: top, middle, zero. */
export function axisTicks(max: number): number[] {
  return [max, max / 2, 0];
}

/**
 * A polyline for a 0–100 box, zero at the bottom. `null` is "not measured" (a bucket with no
 * requests has no percentile) and is skipped rather than drawn at zero, which would read as an
 * instant answer. Fewer than two measurements draw no line at all: a level held across a week
 * nothing was measured in is the same lie. `soleMarker()` covers the single measurement.
 */
export function linePoints(values: (number | null)[], max: number): string {
  const y = (v: number) => (100 - (max > 0 ? (v / max) * 100 : 0)).toFixed(0);
  const drawn = values.flatMap((v, i) =>
    v === null ? [] : [`${bucketCentre(i, values.length).toFixed(0)},${y(v)}`],
  );
  return drawn.length > 1 ? drawn.join(' ') : '';
}

/**
 * Where a bucket's middle sits, as a percentage of the box. The hover columns and the bar chart give
 * each bucket an equal slice, so a vertex belongs over the middle of its own slice; spreading
 * vertices edge to edge would leave the line half a bucket away from the column it reads from.
 */
function bucketCentre(at: number, count: number): number {
  return ((at + 0.5) * 100) / Math.max(1, count);
}

/**
 * Where to put a dot when exactly one bucket in the range was measured, as percentages of the box
 * (`x` from the left, `y` from the bottom), or `null` when a line carries the series instead.
 */
export function soleMarker(values: (number | null)[], max: number): { x: number; y: number } | null {
  const only = values.reduce<number[]>((found, v, i) => (v === null ? found : [...found, i]), []);
  if (only.length !== 1) return null;
  const at = only[0]!;
  return {
    x: bucketCentre(at, values.length),
    y: max > 0 ? (values[at]! / max) * 100 : 0,
  };
}

/**
 * The busiest groups, with everything else summed into one "Other" row. A bar per route is unreadable
 * once an API has thirty of them, and the long tail says nothing a reader can act on.
 */
export function topGroups(
  totals: { group: string; requests: number }[],
  limit: number,
): { group: string; requests: number }[] {
  if (totals.length <= limit) return totals;
  const rest = totals.slice(limit);
  return [
    ...totals.slice(0, limit),
    {
      group: `Other (${rest.length} routes)`,
      requests: rest.reduce((n, t) => n + t.requests, 0),
    },
  ];
}

const STEP = { hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000 };

/**
 * One point per bucket in the range. The API only sends buckets that saw traffic, so without this a
 * week with one busy day draws one bar and repeats its label along the axis.
 */
export function fillBuckets(
  points: TimeseriesPoint[],
  from: string,
  to: string,
  interval: 'hour' | 'day',
): TimeseriesPoint[] {
  const start = new Date(from);
  start.setUTCMinutes(0, 0, 0);
  if (interval === 'day') start.setUTCHours(0);
  const end = new Date(to).getTime();
  const known = new Map(points.map((p) => [new Date(p.bucket).getTime(), p]));
  const filled: TimeseriesPoint[] = [];
  for (let at = start.getTime(); at <= end; at += STEP[interval]) {
    filled.push(
      known.get(at) ?? {
        bucket: new Date(at).toISOString(),
        group: null,
        requests: 0,
        serverErrors: 0,
        latencyP50Ms: null,
        latencyP95Ms: null,
      },
    );
  }
  return filled;
}

/**
 * The route patterns seen in the range, busiest first, for the request log's Route filter. A group
 * comes as "METHOD /path" but `GET /v1/usage/requests?route=` matches the path alone, so the two
 * methods of one path collapse into a single option.
 */
export function routePaths(points: TimeseriesPoint[]): string[] {
  const totals = new Map<string, number>();
  for (const p of points) {
    const path = p.group?.split(' ').at(-1);
    if (!path) continue;
    totals.set(path, (totals.get(path) ?? 0) + p.requests);
  }
  return [...totals].sort((a, b) => b[1] - a[1]).map(([path]) => path);
}

/** Requests per group over the whole range, busiest first (the API sends one point per bucket). */
export function totalsByGroup(points: TimeseriesPoint[]): { group: string; requests: number }[] {
  const totals = new Map<string, number>();
  for (const p of points) {
    const group = p.group ?? '(none)';
    totals.set(group, (totals.get(group) ?? 0) + p.requests);
  }
  return [...totals]
    .map(([group, requests]) => ({ group, requests }))
    .sort((a, b) => b.requests - a.requests);
}
