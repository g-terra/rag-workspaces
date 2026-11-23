import { describe, expect, it } from 'vitest';
import { createLimiter } from './queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createLimiter', () => {
  it('runs at most `limit` tasks at once and starts the next when one ends', async () => {
    const run = createLimiter(3);
    const gates = Array.from({ length: 5 }, deferred);
    const started: number[] = [];
    const done = gates.map((g, i) =>
      run(async () => {
        started.push(i);
        await g.promise;
        return i;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1, 2]);

    gates[1]!.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);

    for (const g of gates) g.resolve();
    expect(await Promise.all(done)).toEqual([0, 1, 2, 3, 4]);
  });

  it('frees the slot when a task throws', async () => {
    const run = createLimiter(1);
    await expect(run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await run(() => Promise.resolve('next'))).toBe('next');
  });
});
