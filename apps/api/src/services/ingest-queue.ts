/**
 * Where uploads go to be ingested. The pg-boss implementation (one file at a time,
 * retries, recovery on start) comes in the next PR; until then documents stay `queued`.
 */
export interface IngestQueue {
  enqueue(documentId: string): Promise<void>;
}

export const noopQueue: IngestQueue = { enqueue: async () => {} };
