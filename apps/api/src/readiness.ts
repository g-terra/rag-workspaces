/**
 * Readiness checks. Each dependency (Postgres, Chroma, Langflow, Keycloak) registers one as it
 * is wired in; `/ready` and `GET /v1/system` run them all. The model providers are not among
 * them: LM Studio being off shouldn't make the API unready, so only `/v1/system` asks them.
 */
export type ReadinessCheck = {
  name: string;
  /** Resolve when the dependency answers; throw (with a useful message) when it does not. */
  check: (signal: AbortSignal) => Promise<void>;
};

export type CheckResult = { name: string; ok: boolean; latencyMs: number; error?: string };

export async function runChecks(checks: ReadinessCheck[], timeoutMs: number): Promise<CheckResult[]> {
  return Promise.all(
    checks.map(async ({ name, check }) => {
      const started = performance.now();
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        await Promise.race([
          check(signal),
          new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () => reject(new Error(`timed out after ${timeoutMs} ms`))),
          ),
        ]);
        return { name, ok: true, latencyMs: Math.round(performance.now() - started) };
      } catch (err) {
        return {
          name,
          ok: false,
          latencyMs: Math.round(performance.now() - started),
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
