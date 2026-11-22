import type { Document } from '@rag/shared';
import { formatBytes, statusLabel } from './files';

/** One file dropped on the upload page, from the browser to the API's answer. */
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
  /** The documents the uploads created or matched, by id. */
  documents: Record<string, Document>;
}

export type SessionAction =
  | { type: 'added'; files: { key: string; name: string; sizeBytes: number; error?: string }[] }
  | { type: 'progress'; key: string; fraction: number }
  | { type: 'uploaded'; key: string; document: Document; duplicate: boolean }
  | { type: 'failed'; key: string; error: string };

export const initialSession: SessionState = { rows: [], documents: {} };

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
      return { ...next, documents: { ...state.documents, [action.document.id]: action.document } };
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
}

/** What a session row shows: its badge, the line under the file name and a progress bar. */
export function rowView(state: SessionState, row: SessionRow): RowView {
  const size = formatBytes(row.sizeBytes);
  const base = { progress: null };
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

  const d = state.documents[row.documentId!]!;
  const meta: Record<Document['status'], string> = {
    queued: `${size} · waiting for the ingest flow`,
    transcribing: `${size} · transcript, then ingest`,
    processing: `${size} · Langflow ingest flow: split, embed, store`,
    ready: `${size} · ${d.passageCount ?? 0} ${d.passageCount === 1 ? 'passage' : 'passages'}`,
    failed: `Attempt ${d.attempts} failed: ${d.error ?? 'no reason given'}`,
  };
  return { ...base, label: statusLabel(d.status), tone: d.status, meta: meta[d.status] };
}

/** "2 uploaded, 1 uploading", for the session list's heading. */
export function sessionSummary(state: SessionState): string {
  const uploaded = state.rows.filter((r) => r.phase === 'stored').length;
  const uploading = state.rows.filter((r) => r.phase === 'uploading').length;
  return `${uploaded} uploaded, ${uploading} uploading`;
}
