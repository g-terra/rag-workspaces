/**
 * The Langflow flows the API runs, by endpoint name. They are imported into Langflow
 * from `flows/` on every Langflow start; the API only checks they are there.
 */
export const FLOWS = {
  ingest: 'rw-ingest',
  retrieve: 'rw-retrieve',
  answer: 'rw-answer',
  /** Like answer, with the conversation so far; the API keeps the history (stateless flow). */
  chat: 'rw-chat',
  delete: 'rw-delete',
} as const;

export const REQUIRED_FLOWS: readonly string[] = Object.values(FLOWS);
