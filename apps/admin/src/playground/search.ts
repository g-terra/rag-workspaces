/** What the playground is doing, kept in the URL as `?mode=` so a tab can be linked to. */
export type Mode = 'ask' | 'search';

export const MODES: [Mode, string][] = [
  ['ask', 'Ask'],
  ['search', 'Search'],
];

/** The mode a `?mode=` value asks for; anything else is the default. */
export function parseMode(value: string | null): Mode {
  return MODES.some(([mode]) => mode === value) ? (value as Mode) : 'ask';
}

/** How many passages a search asks for. The API accepts 1 to 50. */
export const SEARCH_LIMITS = [5, 10, 20];

/** `GET /v1/workspaces/{slug}/passages?query=…&limit=…`, with both values encoded. */
export function searchPath(slug: string, query: string, limit: number): string {
  const search = new URLSearchParams({ query, limit: String(limit) });
  return `/v1/workspaces/${encodeURIComponent(slug)}/passages?${search}`;
}

/** A cosine similarity as the UI shows it: "0.83". */
export function formatScore(score: number): string {
  return score.toFixed(2);
}
