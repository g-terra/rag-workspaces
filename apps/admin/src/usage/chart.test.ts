import { describe, expect, it } from 'vitest';
import {
  axisTicks,
  barHeights,
  fillBuckets,
  linePoints,
  niceMax,
  routePaths,
  soleMarker,
  topGroups,
  totalsByGroup,
} from './chart';

describe('niceMax', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceMax([98, 112, 201])).toBe(500);
    expect(niceMax([3, 7])).toBe(10);
    expect(niceMax([1200, 900])).toBe(2000);
  });

  it('is 1 for an empty series or one that is all zeros, so the axis still has a top', () => {
    expect(niceMax([])).toBe(1);
    expect(niceMax([0, 0, 0])).toBe(1);
  });
});

describe('barHeights', () => {
  it('is each value as a percentage of the top of the axis', () => {
    expect(barHeights([50, 100], 100)).toEqual([50, 100]);
  });

  it('is flat at zero when nothing happened, instead of dividing by zero', () => {
    expect(barHeights([0, 0], niceMax([0, 0]))).toEqual([0, 0]);
  });
});

describe('axisTicks', () => {
  it('is the top, the middle and zero', () => {
    expect(axisTicks(500)).toEqual([500, 250, 0]);
  });
});

describe('linePoints', () => {
  it('spreads the values across the width, zero at the bottom', () => {
    expect(linePoints([0, 50, 100], 100)).toBe('0,100 50,50 100,0');
  });

  it('is a flat line at the bottom when every value is zero', () => {
    expect(linePoints([0, 0], 1)).toBe('0,100 100,100');
  });

  it('draws no line for one measurement or none: one point is a dot, not a week-long level', () => {
    expect(linePoints([100], 100)).toBe('');
    expect(linePoints([null, 42, null], 100)).toBe('');
    expect(linePoints([], 100)).toBe('');
  });

  it('skips a bucket with no measurement instead of drawing it as zero', () => {
    // A quiet hour has no p95 at all; a 0 there would read as "instant answers".
    expect(linePoints([null, 50, null, 100], 100)).toBe('33,50 100,0');
  });
});

describe('soleMarker', () => {
  it('places a dot when exactly one bucket was measured, as a share of the box', () => {
    expect(soleMarker([null, 42, null], 100)).toEqual({ x: 50, y: 42 });
    expect(soleMarker([25, null, null, null, null], 100)).toEqual({ x: 0, y: 25 });
  });

  it('is nothing when a line can be drawn, or when there is nothing at all', () => {
    expect(soleMarker([10, 20], 100)).toBeNull();
    expect(soleMarker([null, null], 100)).toBeNull();
    expect(soleMarker([], 100)).toBeNull();
  });
});

describe('totalsByGroup', () => {
  const point = (group: string | null, requests: number) => ({
    bucket: '2026-11-23T00:00:00.000Z',
    group,
    requests,
    serverErrors: 0,
    latencyP50Ms: null,
    latencyP95Ms: null,
  });

  it('sums each group over the range, busiest first', () => {
    expect(
      totalsByGroup([
        point('POST /v1/workspaces/:slug/answers', 10),
        point('GET /v1/usage/summary', 3),
        point('POST /v1/workspaces/:slug/answers', 5),
      ]),
    ).toEqual([
      { group: 'POST /v1/workspaces/:slug/answers', requests: 15 },
      { group: 'GET /v1/usage/summary', requests: 3 },
    ]);
  });

  it('names the ungrouped bucket, since the API sends null for "no caller"', () => {
    expect(totalsByGroup([point(null, 2)])).toEqual([{ group: '(none)', requests: 2 }]);
  });
});

describe('topGroups', () => {
  const totals = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ group: `route-${i}`, requests: 100 - i }));

  it('leaves a short list alone', () => {
    expect(topGroups(totals(3), 7)).toEqual(totals(3));
  });

  it('keeps the busiest and sums the rest into one "Other" row', () => {
    const folded = topGroups(totals(10), 7);
    expect(folded).toHaveLength(8);
    expect(folded.slice(0, 7)).toEqual(totals(10).slice(0, 7));
    expect(folded.at(-1)).toEqual({ group: 'Other (3 routes)', requests: 93 + 92 + 91 });
  });
});

describe('fillBuckets', () => {
  const point = (bucket: string, requests: number) => ({
    bucket,
    group: null,
    requests,
    serverErrors: 0,
    latencyP50Ms: null,
    latencyP95Ms: null,
  });

  it('adds the buckets the API left out, so a range of days shows every day', () => {
    const filled = fillBuckets(
      [point('2026-11-22T00:00:00.000Z', 12)],
      '2026-11-20T10:30:00.000Z',
      '2026-11-23T10:30:00.000Z',
      'day',
    );
    expect(filled.map((p) => [p.bucket.slice(0, 10), p.requests])).toEqual([
      ['2026-11-20', 0],
      ['2026-11-21', 0],
      ['2026-11-22', 12],
      ['2026-11-23', 0],
    ]);
  });

  it('counts hours for an hour range, from the start of the first hour', () => {
    const filled = fillBuckets(
      [point('2026-11-23T09:00:00.000Z', 3)],
      '2026-11-23T08:30:00.000Z',
      '2026-11-23T10:30:00.000Z',
      'hour',
    );
    expect(filled.map((p) => [p.bucket, p.requests])).toEqual([
      ['2026-11-23T08:00:00.000Z', 0],
      ['2026-11-23T09:00:00.000Z', 3],
      ['2026-11-23T10:00:00.000Z', 0],
    ]);
  });

  it('is all zeros when nothing happened, so the chart shows the quiet days', () => {
    const filled = fillBuckets([], '2026-11-21T10:30:00.000Z', '2026-11-23T10:30:00.000Z', 'day');
    expect(filled.map((p) => p.requests)).toEqual([0, 0, 0]);
    expect(filled.every((p) => p.latencyP95Ms === null)).toBe(true);
  });
});

describe('routePaths', () => {
  const point = (group: string | null, requests: number) => ({
    bucket: '2026-11-23T00:00:00.000Z',
    group,
    requests,
    serverErrors: 0,
    latencyP50Ms: null,
    latencyP95Ms: null,
  });

  it('drops the method, so one path is one filter option, busiest first', () => {
    expect(
      routePaths([
        point('GET /v1/usage/summary', 2),
        point('POST /v1/workspaces/:slug/answers', 4),
        point('GET /v1/workspaces/:slug/answers', 3),
      ]),
    ).toEqual(['/v1/workspaces/:slug/answers', '/v1/usage/summary']);
  });

  it('skips a point with no group at all', () => {
    expect(routePaths([point(null, 5)])).toEqual([]);
  });
});
