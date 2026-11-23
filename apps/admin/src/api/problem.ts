/** A refused request's reason: the problem JSON's detail or title, else the status text, else `HTTP 502`. */
export function failureDetail(
  body: { detail?: string; title?: string } | null,
  status: number,
  statusText: string,
): string {
  return body?.detail ?? body?.title ?? (statusText || `HTTP ${status}`);
}

/** The same reason read from a `Response` whose body may not be problem JSON at all. */
export async function problemDetail(res: Response): Promise<string> {
  let body: { detail?: string; title?: string } | null = null;
  try {
    body = (await res.json()) as { detail?: string; title?: string };
  } catch {
    // Not JSON (an nginx error page, an empty body): fall back to the status.
  }
  return failureDetail(body, res.status, res.statusText);
}
