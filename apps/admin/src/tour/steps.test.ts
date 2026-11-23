import { describe, expect, it } from 'vitest';
import { nextStepIndex, stepPosition, TOUR_STEPS, type TourStep } from './steps';

const steps: TourStep[] = [
  { id: 'welcome', title: 'Welcome', body: '' },
  { id: 'a', target: 'a', title: 'A', body: '' },
  { id: 'b', target: 'b', title: 'B', body: '' },
  { id: 'c', target: 'c', title: 'C', body: '' },
];
const only =
  (...targets: string[]) =>
  (t: string) =>
    targets.includes(t);

describe('nextStepIndex', () => {
  it('starts at the first available step', () => {
    expect(nextStepIndex(steps, -1, 1, only())).toBe(0);
  });

  it('skips steps whose target is not on screen', () => {
    expect(nextStepIndex(steps, 0, 1, only('c'))).toBe(3);
  });

  it('goes back over missing targets too', () => {
    expect(nextStepIndex(steps, 3, -1, only('c'))).toBe(0);
  });

  it('returns null past the end or before the start', () => {
    expect(nextStepIndex(steps, 3, 1, only('a', 'b', 'c'))).toBeNull();
    expect(nextStepIndex(steps, 1, 1, only('a'))).toBeNull();
    expect(nextStepIndex(steps, 0, -1, only('a'))).toBeNull();
  });
});

describe('stepPosition', () => {
  it('counts only the steps that are available', () => {
    expect(stepPosition(steps, 3, only('c'))).toEqual({ n: 2, of: 2 });
    expect(stepPosition(steps, 2, only('a', 'b', 'c'))).toEqual({ n: 3, of: 4 });
  });
});

describe('TOUR_STEPS', () => {
  it('opens with an untargeted welcome and ends at the Help button', () => {
    expect(TOUR_STEPS[0]!.target).toBeUndefined();
    expect(TOUR_STEPS.at(-1)!.target).toBe('help');
  });

  it('has unique ids', () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });
});
