import { EventEmitter } from 'node:events';
import type { Document } from '@rag/db';

export type DocumentEvent = { workspaceId: string; document: Document };

/**
 * In-process notifications when a document's status changes. One API process is the
 * design (decision 15), so there is no pub/sub; the live status stream listens here.
 */
export class DocumentEvents {
  private readonly emitter = new EventEmitter().setMaxListeners(0);

  emit(event: DocumentEvent) {
    this.emitter.emit('change', event);
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: (event: DocumentEvent) => void): () => void {
    this.emitter.on('change', listener);
    return () => this.emitter.off('change', listener);
  }
}
