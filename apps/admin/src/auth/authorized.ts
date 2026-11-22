export interface TokenSource {
  /** The current access token, renewed first if it has expired. */
  getToken(): Promise<string | null>;
  /** Renews the token now, even if it hasn't expired; null when it can't be renewed. */
  renewToken(): Promise<string | null>;
  /** Ends the session, the way `api` does on a 401. */
  endSession(): void;
}

/**
 * Sends a request `api` can't make (an upload, a stream) with a token fetched right before sending. On a
 * 401 it renews the token once and sends again; if that fails too, it ends the session.
 */
export async function sendAuthorized<T extends { status: number }>(
  auth: TokenSource,
  send: (token: string | null) => Promise<T>,
): Promise<T> {
  const first = await send(await auth.getToken());
  if (first.status !== 401) return first;
  const token = await auth.renewToken();
  if (!token) {
    auth.endSession();
    return first;
  }
  const second = await send(token);
  if (second.status === 401) auth.endSession();
  return second;
}
