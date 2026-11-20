/**
 * The Langflow flows the API runs, by endpoint name. They are imported into Langflow
 * from `flows/` on every Langflow start; the API only checks they are there.
 * M1 renames them to the `rw-*` names in docs/architecture.md and adds the chat flow.
 */
export const FLOWS = {
  ingest: 'rag-ingest',
  retrieve: 'rag-retrieve',
  answer: 'rag-answer',
  delete: 'rag-delete',
} as const;

export const REQUIRED_FLOWS: readonly string[] = Object.values(FLOWS);
