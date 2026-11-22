import type { Document } from '@rag/shared';
import type { DocumentEvent } from './events';
import { formatBytes, statusLabel } from './files';

/** One file dropped on the upload page, from the browser to the end of ingestion. */
export interface SessionRow {
  key: string;
  name: string;
  sizeBytes: number;
  phase: 'uploading' | 'rejected' | 'stored' | 'skipped';
  /** Share of the upload sent, from 0 to 1. */
  progress: number;
  /** Why the upload was refused (phase `rejected`). */
  error: string | null;
  documentId: string | null;
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
  | { type: 'progress'; key: string; fraction: number }
  | { type: 'uploaded'; key: string; document: Document; duplicate: boolean }
  | { type: 'failed'; key: string; error: string }
  | { type: 'event'; event: DocumentEvent }
  /** A newer copy of a document, such as the answer to Retry. */
  | { type: 'document'; document: Document };

export const initialSession: SessionState = { rows: [], documents: {} };

/** Keeps the newer of the two copies (the stream can repeat an older state). */
function remember(docs: SessionState['documents'], d: Document): SessionState['documents'] {
  const known = docs[d.id];
  if (known && known.updatedAt > d.updatedAt) return docs;
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
        phase: f.error ? 'rejected' : 'uploading',
        progress: 0,
        error: f.error ?? null,
        documentId: null,
      }));
      return { ...state, rows: [...added, ...state.rows] };
    }
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
    case 'event': {
      const e = action.event;
      if (e.type === 'removed') return { ...state, documents: { ...state.documents, [e.id]: null } };
      const docs = e.type === 'snapshot' ? e.documents : [e.document];
      return { ...state, documents: docs.reduce(remember, state.documents) };
    }
  }
}

export type Tone = 'uploading' | 'queued' | 'transcribing' | 'processing' | 'ready' | 'failed' | 'skipped';

export interface RowView {
  label: string;
  tone: Tone;
  meta: string;
  /** Upload percentage while uploading, else null. */
  progress: number | null;
  canRetry: boolean;
  document: Document | null;
}

/** What a session row shows: its badge, the line under the file name, a progress bar and Retry. */
export function rowView(state: SessionState, row: SessionRow): RowView {
  const size = formatBytes(row.sizeBytes);
  const base = { progress: null, canRetry: false, document: null };
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

/** "2 ready, 1 in progress", for the session list's heading. */
export function sessionSummary(state: SessionState): string {
  let ready = 0;
  let active = 0;
  for (const row of state.rows) {
    const v = rowView(state, row);
    if (v.tone === 'ready') ready++;
    else if (['uploading', 'queued', 'transcribing', 'processing'].includes(v.tone) && v.label !== 'Deleted')
      active++;
  }
  return `${ready} ready, ${active} in progress`;
}
