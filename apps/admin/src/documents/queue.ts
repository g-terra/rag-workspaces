/**
 * Runs the tasks given to it at most `limit` at a time, in the order given; the rest wait their turn.
 * The upload page sends files through one, so a large drop doesn't open dozens of requests at once.
 */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < limit) active++;
    // The finishing task hands its slot straight to the next one, so `active` stays the same.
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
