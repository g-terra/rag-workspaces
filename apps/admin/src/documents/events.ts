import { Document } from '@rag/shared';
import { z } from 'zod';
import type { SseEvent } from './sse';

/** What `GET /v1/workspaces/{slug}/documents/events` says, decoded. */
export type DocumentEvent =
  | { type: 'snapshot'; documents: Document[] }
  | { type: 'document'; document: Document }
  | { type: 'removed'; id: string };

/** The snapshot holds only unfinished documents (queued, transcribing, processing). */
const Snapshot = z.object({ data: Document.array() });
const Removed = z.object({ id: z.string() });

/** Decodes one server-sent event; null for an event this UI doesn't know or a body that isn't its shape. */
export function toDocumentEvent(e: SseEvent): DocumentEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(e.data);
  } catch {
    return null;
  }
  if (e.event === 'snapshot') {
    const parsed = Snapshot.safeParse(body);
    return parsed.success ? { type: 'snapshot', documents: parsed.data.data } : null;
  }
  if (e.event === 'document') {
    const parsed = Document.safeParse(body);
    return parsed.success ? { type: 'document', document: parsed.data } : null;
  }
  if (e.event === 'removed') {
    const parsed = Removed.safeParse(body);
    return parsed.success ? { type: 'removed', id: parsed.data.id } : null;
  }
  return null;
}
