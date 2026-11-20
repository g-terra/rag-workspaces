/**
 * The Langflow flows the API runs, by endpoint name. They are imported into Langflow
 * from `flows/` on every Langflow start; the API only checks they are there.
 * A stateless `rw-chat` flow joins them with conversations (M2).
 */
export const FLOWS = {
  ingest: 'rw-ingest',
  retrieve: 'rw-retrieve',
  answer: 'rw-answer',
  delete: 'rw-delete',
} as const;

export const REQUIRED_FLOWS: readonly string[] = Object.values(FLOWS);
