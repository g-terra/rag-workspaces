import type { Document } from '@rag/shared';
import type { DocumentEvent } from './events';
import { formatBytes, statusLabel } from './files';

/** One file dropped on the upload page, from the browser to the end of ingestion. */
export interface SessionRow {
  key: string;
  name: string;
  sizeBytes: number;
  /** `waiting`: in the upload queue, behind the files being sent. */
  phase: 'waiting' | 'uploading' | 'rejected' | 'stored' | 'skipped';
  /** Share of the upload sent, from 0 to 1. */
  progress: number;
  /** Why the upload was refused (phase `rejected`). */
  error: string | null;
  documentId: string | null;
  /** A Retry request is on its way. */
  retryPending: boolean;
  /** Why the last Retry was refused. */
  retryError: string | null;
}

export interface SessionState {
  rows: SessionRow[];
  /**
   * The latest copy of every document seen, from upload answers and the status stream, kept even
   * before its upload answers (an event can arrive first). Null once deleted.
   */
  documents: Record<string, Document | null>;
}

export type SessionAction =
  | { type: 'added'; files: { key: string; name: string; sizeBytes: number; error?: string }[] }
  | { type: 'started'; key: string }
  | { type: 'progress'; key: string; fraction: number }
  | { type: 'uploaded'; key: string; document: Document; duplicate: boolean }
  | { type: 'failed'; key: string; error: string }
  | { type: 'event'; event: DocumentEvent }
  /** A newer copy of a document, such as one fetched after a reconnect. */
  | { type: 'document'; document: Document }
  | { type: 'retry'; key: string }
  /** The answer to Retry: the document back in the queue. */
  | { type: 'retried'; key: string; document: Document }
  | { type: 'retryFailed'; key: string; error: string };

export const initialSession: SessionState = { rows: [], documents: {} };

const UNFINISHED: Document['status'][] = ['queued', 'transcribing', 'processing'];
/** How far along ingestion a status is, to order two copies with the same `updatedAt`. */
const RANK: Record<Document['status'], number> = {
  queued: 0,
  transcribing: 1,
  processing: 2,
  ready: 3,
  failed: 3,
};

/**
 * Keeps the newer of the two copies (the stream can repeat an older state). With the same `updatedAt`
 * the known copy stays, unless the new one is further along.
 */
function remember(docs: SessionState['documents'], d: Document): SessionState['documents'] {
  const known = docs[d.id];
  if (known) {
    if (known.updatedAt > d.updatedAt) return docs;
    if (known.updatedAt === d.updatedAt && RANK[d.status] <= RANK[known.status]) return docs;
  }
  return { ...docs, [d.id]: d };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  const update = (key: string, change: Partial<SessionRow>) => ({
    ...state,
    rows: state.rows.map((r) => (r.key === key ? { ...r, ...change } : r)),
  });
  switch (action.type) {
    case 'added': {
      const added = action.files.map((f): SessionRow => ({
        key: f.key,
        name: f.name,
        sizeBytes: f.sizeBytes,
        phase: f.error ? 'rejected' : 'waiting',
        progress: 0,
        error: f.error ?? null,
        documentId: null,
        retryPending: false,
        retryError: null,
      }));
      return { ...state, rows: [...added, ...state.rows] };
    }
    case 'started':
      return update(action.key, { phase: 'uploading' });
    case 'progress':
      return update(action.key, { progress: action.fraction });
    case 'failed':
      return update(action.key, { phase: 'rejected', error: action.error });
    case 'uploaded': {
      const next = update(action.key, {
        phase: action.duplicate ? 'skipped' : 'stored',
        progress: 1,
        documentId: action.document.id,
      });
      return { ...next, documents: remember(state.documents, action.document) };
    }
    case 'document':
      return { ...state, documents: remember(state.documents, action.document) };
    case 'retry':
      return update(action.key, { retryPending: true, retryError: null });
    case 'retried':
      return {
        ...update(action.key, { retryPending: false }),
        documents: remember(state.documents, action.document),
      };
    case 'retryFailed':
      return update(action.key, { retryPending: false, retryError: action.error });
    case 'event': {
      const e = action.event;
      if (e.type === 'removed') return { ...state, documents: { ...state.documents, [e.id]: null } };
      const docs = e.type === 'snapshot' ? e.documents : [e.document];
      return { ...state, documents: docs.reduce(remember, state.documents) };
    }
  }
}

export type Tone =
  'waiting' | 'uploading' | 'queued' | 'transcribing' | 'processing' | 'ready' | 'failed' | 'skipped';

export interface RowView {
  label: string;
  tone: Tone;
  meta: string;
  /** Upload percentage while uploading, else null. */
  progress: number | null;
  canRetry: boolean;
  /** Retry was pressed and the API hasn't answered yet. */
  retryPending: boolean;
  /** Why the last Retry was refused. */
  retryError: string | null;
  document: Document | null;
}

/** What a session row shows: its badge, the line under the file name, a progress bar and Retry. */
export function rowView(state: SessionState, row: SessionRow): RowView {
  const size = formatBytes(row.sizeBytes);
  const base = {
    progress: null,
    canRetry: false,
    retryPending: row.retryPending,
    retryError: row.retryError,
    document: null,
  };
  if (row.phase === 'waiting') return { ...base, label: 'Waiting', tone: 'waiting', meta: size };
  if (row.phase === 'uploading') {
    const pct = Math.round(row.progress * 100);
    return { ...base, label: 'Uploading', tone: 'uploading', meta: `${size} · ${pct}%`, progress: pct };
  }
  if (row.phase === 'rejected')
    return { ...base, label: 'Not uploaded', tone: 'failed', meta: row.error ?? '' };
  if (row.phase === 'skipped')
    return {
      ...base,
      label: 'Skipped',
      tone: 'skipped',
      meta: 'Skipped: identical file already in this workspace',
    };

  const d = state.documents[row.documentId!];
  if (!d) return { ...base, label: 'Deleted', tone: 'queued', meta: 'Deleted from the library.' };
  const meta: Record<Document['status'], string> = {
    queued: `${size} · waiting for the ingest flow`,
    transcribing: `${size} · transcript, then ingest`,
    processing: `${size} · Langflow ingest flow: split, embed, store`,
    ready: `${size} · ${d.passageCount ?? 0} ${d.passageCount === 1 ? 'passage' : 'passages'}`,
    failed: `Attempt ${d.attempts} failed: ${d.error ?? 'no reason given'}`,
  };
  return {
    ...base,
    label: statusLabel(d.status),
    tone: d.status,
    meta: meta[d.status],
    canRetry: d.status === 'failed',
    document: d,
  };
}

/** "2 ready, 1 in progress", for the session list's heading and screen readers. */
export function sessionSummary(state: SessionState): string {
  let ready = 0;
  let active = 0;
  for (const row of state.rows) {
    const v = rowView(state, row);
    if (v.tone === 'ready') ready++;
    else if (
      ['waiting', 'uploading', 'queued', 'transcribing', 'processing'].includes(v.tone) &&
      v.label !== 'Deleted'
    )
      active++;
  }
  return `${ready} ready, ${active} in progress`;
}

/**
 * The unfinished documents of this session's uploads that a snapshot no longer lists. The snapshot holds
 * only unfinished documents, so these finished or were deleted while the stream was down; the page
 * fetches each one to catch up.
 */
export function missingFromSnapshot(state: SessionState, snapshot: Document[]): string[] {
  const listed = new Set(snapshot.map((d) => d.id));
  const ids = new Set<string>();
  for (const row of state.rows) {
    if (row.phase !== 'stored' || !row.documentId) continue;
    const d = state.documents[row.documentId];
    if (d && UNFINISHED.includes(d.status) && !listed.has(d.id)) ids.add(d.id);
  }
  return [...ids];
}
