import { describe, expect, it } from 'vitest';
import {
  bucketLabel,
  formatCount,
  formatDuration,
  formatPercent,
  formatTokens,
  intervalFor,
  rangeFor,
  statusTone,
} from './range';

const now = new Date('2026-11-23T10:30:00.000Z');

describe('rangeFor', () => {
  it('counts back from now, in whole hours or days', () => {
    expect(rangeFor('24h', now)).toEqual({
      from: '2026-11-22T10:30:00.000Z',
      to: '2026-11-23T10:30:00.000Z',
    });
    expect(rangeFor('7d', now).from).toBe('2026-11-16T10:30:00.000Z');
    expect(rangeFor('30d', now).from).toBe('2026-10-24T10:30:00.000Z');
  });
});

describe('intervalFor', () => {
  it('buckets a day by the hour and anything longer by the day', () => {
    expect(intervalFor('24h')).toBe('hour');
    expect(intervalFor('7d')).toBe('day');
    expect(intervalFor('30d')).toBe('day');
  });
});

describe('formatDuration', () => {
  it('is milliseconds under a second, then seconds', () => {
    expect(formatDuration(84)).toBe('84 ms');
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(1840)).toBe('1.8 s');
    expect(formatDuration(12_000)).toBe('12.0 s');
  });

  it('is a dash when the API has no number (no requests in the range)', () => {
    expect(formatDuration(null)).toBe('–');
  });
});

describe('formatPercent', () => {
  it('is one decimal of the rate the API sends', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.0123)).toBe('1.2%');
    expect(formatPercent(1)).toBe('100%');
  });
});

describe('formatTokens', () => {
  it('shortens thousands and millions', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(940)).toBe('940');
    expect(formatTokens(12_345)).toBe('12.3 k');
    expect(formatTokens(2_100_000)).toBe('2.1 M');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1284)).toBe('1,284');
  });
});

describe('statusTone', () => {
  it('separates success, the caller’s fault and ours', () => {
    expect(statusTone(201)).toBe('ok');
    expect(statusTone(304)).toBe('ok');
    expect(statusTone(404)).toBe('client');
    expect(statusTone(503)).toBe('server');
  });
});

describe('bucketLabel', () => {
  it('is the day for day buckets and the hour for hour buckets, in UTC', () => {
    expect(bucketLabel('2026-11-07T00:00:00.000Z', 'day')).toBe('7 Nov');
    expect(bucketLabel('2026-11-23T15:00:00.000Z', 'hour')).toBe('15:00');
  });
});
