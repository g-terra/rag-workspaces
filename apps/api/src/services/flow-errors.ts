import { LangflowError } from '@rag/langflow-client';
import { HttpProblem } from '../errors.js';
import { ProviderNotConfigured } from './providers.js';

/**
 * Turn a failed flow run into a response a caller can act on, instead of a bare 500:
 * - 503 when the API is not able to run flows yet (Langflow starting, a provider key missing),
 * - 504 when the run took too long,
 * - 502 when Langflow ran the flow and it failed (the reason is Langflow's own message).
 */
export function flowProblem(err: unknown, what: string): unknown {
  if (err instanceof HttpProblem) return err;
  if (err instanceof ProviderNotConfigured) {
    return new HttpProblem(503, `${what} is not available: ${err.message}.`);
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new HttpProblem(504, `${what} took too long.`);
  }
  if (err instanceof LangflowError) {
    if (err.status === 0) {
      return new HttpProblem(503, 'Langflow is still starting. Try again shortly.', undefined, {
        'retry-after': '10',
      });
    }
    return new HttpProblem(502, `${what} failed in Langflow: ${err.detail || `HTTP ${err.status}`}`);
  }
  if (err instanceof TypeError && err.message === 'fetch failed') {
    // fetch() could not reach Langflow at all. Other TypeErrors are bugs and stay 500s.
    return new HttpProblem(503, 'Langflow is not reachable.', undefined, { 'retry-after': '10' });
  }
  return err;
}
