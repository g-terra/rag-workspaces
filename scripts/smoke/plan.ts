/**
 * What `up` does with what it finds: `reuse` a stack that still has its `.env.smoke`, start `fresh`, or
 * `reset` a stack whose `.env.smoke` is gone. Its volumes were made with passwords that went with the
 * file, so starting on them fails ("password authentication failed"). That happens on a self-hosted CI
 * runner when a job is cancelled before its `down`, and the next checkout cleans the ignored file away.
 */
export function planUp(found: { envFile: boolean; leftovers: boolean }): 'reuse' | 'fresh' | 'reset' {
  if (!found.leftovers) return 'fresh';
  return found.envFile ? 'reuse' : 'reset';
}
