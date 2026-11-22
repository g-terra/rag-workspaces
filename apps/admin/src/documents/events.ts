import type { Document } from '@rag/shared';
import type { SseEvent } from './sse';

/** What `GET /v1/workspaces/{slug}/documents/events` says, decoded. */
export type DocumentEvent =
  | { type: 'snapshot'; documents: Document[] }
  | { type: 'document'; document: Document }
  | { type: 'removed'; id: string };

/** Decodes one server-sent event; null for an event this UI doesn't know or a body it can't read. */
export function toDocumentEvent(e: SseEvent): DocumentEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(e.data);
  } catch {
    return null;
  }
  if (e.event === 'snapshot') return { type: 'snapshot', documents: (body as { data: Document[] }).data };
  if (e.event === 'document') return { type: 'document', document: body as Document };
  if (e.event === 'removed') return { type: 'removed', id: (body as { id: string }).id };
  return null;
}
