/** What the playground is doing, kept in the URL as `?mode=` so a tab can be linked to. */
export type Mode = 'ask' | 'search' | 'chat';

/** The playground's tabs, each with the sentence shown under them so you know what it does. */
export const MODES: { key: Mode; label: string; help: string }[] = [
  {
    key: 'ask',
    label: 'Ask',
    help: 'One question, one answer written from this workspace’s material, with the passages it cites. Nothing is remembered between questions.',
  },
  {
    key: 'search',
    label: 'Search',
    help: 'Finds the passages closest to your words and scores them. No model is called, so it is fast and shows what an answer would be given.',
  },
  {
    key: 'chat',
    label: 'Chat',
    help: 'A conversation: each reply sees the earlier turns, so follow-up questions like “why?” work. Kept under Conversations.',
  },
];

/** The mode a `?mode=` value asks for; anything else is the default. */
export function parseMode(value: string | null): Mode {
  return MODES.some((m) => m.key === value) ? (value as Mode) : 'ask';
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
