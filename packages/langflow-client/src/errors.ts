/** A non-2xx answer from Langflow. `detail` is Langflow's own error text when it sent one. */
export class LangflowError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Langflow ${operation} failed: HTTP ${status}${detail ? ` ${detail}` : ''}`);
    this.name = 'LangflowError';
  }
}

/** Pull the most useful message out of a Langflow error body (`{detail: string | {message}}`). */
export function errorDetail(body: string): string {
  try {
    const json = JSON.parse(body) as { detail?: unknown };
    const d = json.detail;
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object' && 'message' in d && typeof d.message === 'string') return d.message;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 500);
}
