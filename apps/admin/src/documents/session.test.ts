import type { Document } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import { toDocumentEvent } from './events';
import { initialSession, rowView, sessionReducer, sessionSummary, type SessionState } from './session';

function doc(over: Partial<Document> = {}): Document {
  return {
    id: 'doc_1',
    workspace: 'ouc',
    title: 'notes',
    fileName: 'notes.md',
    type: 'md',
    sizeBytes: 2048,
    sha256: 'ab'.repeat(32),
    status: 'queued',
    attempts: 0,
    error: null,
    passageCount: null,
    tags: [],
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    ...over,
  };
}

const later = (s: number) => `2026-11-22T10:00:${String(s).padStart(2, '0')}.000Z`;

function withUpload(): SessionState {
  return sessionReducer(initialSession, {
    type: 'added',
    files: [{ key: 'k1', name: 'notes.md', sizeBytes: 2048 }],
  });
}

describe('toDocumentEvent', () => {
  it('decodes snapshot, document and removed events', () => {
    const d = doc();
    expect(toDocumentEvent({ event: 'snapshot', data: JSON.stringify({ data: [d] }) })).toEqual({
      type: 'snapshot',
      documents: [d],
    });
    expect(toDocumentEvent({ event: 'document', data: JSON.stringify(d) })).toEqual({
      type: 'document',
      document: d,
    });
    expect(toDocumentEvent({ event: 'removed', data: '{"id":"doc_1"}' })).toEqual({
      type: 'removed',
      id: 'doc_1',
    });
  });

  it('skips unknown events and bad JSON', () => {
    expect(toDocumentEvent({ event: 'other', data: '{}' })).toBeNull();
    expect(toDocumentEvent({ event: 'document', data: '{oops' })).toBeNull();
  });
});

describe('sessionReducer', () => {
  it('adds files as uploading, or as rejected with the reason', () => {
    const s = sessionReducer(initialSession, {
      type: 'added',
      files: [
        { key: 'k1', name: 'a.md', sizeBytes: 10 },
        { key: 'k2', name: 'b.exe', sizeBytes: 10, error: 'Not supported' },
      ],
    });
    expect(s.rows.map((r) => [r.phase, r.error])).toEqual([
      ['uploading', null],
      ['rejected', 'Not supported'],
    ]);
  });

  it('puts newer drops above earlier ones', () => {
    let s = withUpload();
    s = sessionReducer(s, { type: 'added', files: [{ key: 'k2', name: 'b.md', sizeBytes: 1 }] });
    expect(s.rows.map((r) => r.key)).toEqual(['k2', 'k1']);
  });

  it('tracks upload progress, then the stored document', () => {
    let s = sessionReducer(withUpload(), { type: 'progress', key: 'k1', fraction: 0.45 });
    expect(rowView(s, s.rows[0]!)).toMatchObject({ label: 'Uploading', tone: 'uploading', progress: 45 });
    s = sessionReducer(s, { type: 'uploaded', key: 'k1', document: doc(), duplicate: false });
    expect(rowView(s, s.rows[0]!)).toMatchObject({
      label: 'Queued',
      tone: 'queued',
      meta: '2 KB · waiting for the ingest flow',
      progress: null,
      canRetry: false,
    });
  });

  it('follows status events for the uploaded document', () => {
    let s = sessionReducer(withUpload(), { type: 'uploaded', key: 'k1', document: doc(), duplicate: false });
    s = sessionReducer(s, {
      type: 'event',
      event: { type: 'document', document: doc({ status: 'processing', updatedAt: later(1) }) },
    });
    expect(rowView(s, s.rows[0]!)).toMatchObject({
      label: 'Processing',
      meta: '2 KB · Langflow ingest flow: split, embed, store',
    });
    s = sessionReducer(s, {
      type: 'event',
      event: { type: 'document', document: doc({ status: 'ready', passageCount: 12, updatedAt: later(2) }) },
    });
    expect(rowView(s, s.rows[0]!)).toMatchObject({
      label: 'Ready',
      tone: 'ready',
      meta: '2 KB · 12 passages',
    });
  });

  it('says "1 passage" for a single one', () => {
    let s = sessionReducer(withUpload(), { type: 'uploaded', key: 'k1', document: doc(), duplicate: false });
    s = sessionReducer(s, {
      type: 'document',
      document: doc({ status: 'ready', passageCount: 1, updatedAt: later(1) }),
    });
    expect(rowView(s, s.rows[0]!).meta).toBe('2 KB · 1 passage');
  });

  it('keeps an event that arrives before the upload answer', () => {
    let s = sessionReducer(withUpload(), {
      type: 'event',
      event: { type: 'document', document: doc({ status: 'processing', updatedAt: later(1) }) },
    });
    s = sessionReducer(s, { type: 'uploaded', key: 'k1', document: doc(), duplicate: false });
    expect(rowView(s, s.rows[0]!).label).toBe('Processing');
  });

  it('ignores an older copy of a document', () => {
    let s = sessionReducer(withUpload(), {
      type: 'uploaded',
      key: 'k1',
      document: doc({ status: 'ready', passageCount: 3, updatedAt: later(5) }),
      duplicate: false,
    });
    s = sessionReducer(s, {
      type: 'event',
      event: { type: 'snapshot', documents: [doc({ updatedAt: later(1) })] },
    });
    expect(rowView(s, s.rows[0]!).label).toBe('Ready');
  });

  it('applies the snapshot sent on reconnect', () => {
    let s = sessionReducer(withUpload(), { type: 'uploaded', key: 'k1', document: doc(), duplicate: false });
    s = sessionReducer(s, {
      type: 'event',
      event: { type: 'snapshot', documents: [doc({ status: 'processing', updatedAt: later(3) })] },
    });
    expect(rowView(s, s.rows[0]!).label).toBe('Processing');
  });

  it('shows a duplicate as skipped, whatever the existing document does', () => {
    let s = sessionReducer(withUpload(), {
      type: 'uploaded',
      key: 'k1',
      document: doc({ status: 'ready' }),
      duplicate: true,
    });
    s = sessionReducer(s, {
      type: 'event',
      event: { type: 'document', document: doc({ status: 'processing', updatedAt: later(1) }) },
    });
    expect(rowView(s, s.rows[0]!)).toMatchObject({
      label: 'Skipped',
      tone: 'skipped',
      meta: 'Skipped: identical file already in this workspace',
    });
  });

  it('shows a refused upload with its reason', () => {
    const s = sessionReducer(withUpload(), { type: 'failed', key: 'k1', error: 'Too large' });
    expect(rowView(s, s.rows[0]!)).toMatchObject({
      label: 'Not uploaded',
      tone: 'failed',
      meta: 'Too large',
    });
  });

  it('offers Retry on a failed document, with its error', () => {
    let s = sessionReducer(withUpload(), { type: 'uploaded', key: 'k1', document: doc(), duplicate: false });
    s = sessionReducer(s, {
      type: 'event',
      event: {
        type: 'document',
        document: doc({ status: 'failed', attempts: 4, error: 'No text found', updatedAt: later(1) }),
      },
    });
    expect(rowView(s, s.rows[0]!)).toMatchObject({
      label: 'Failed',
      meta: 'Attempt 4 failed: No text found',
      canRetry: true,
    });
    // Retry answers with the document back in the queue.
    s = sessionReducer(s, { type: 'document', document: doc({ status: 'queued', updatedAt: later(2) }) });
    expect(rowView(s, s.rows[0]!)).toMatchObject({ label: 'Queued', canRetry: false });
  });

  it('says when an uploaded document was deleted', () => {
    let s = sessionReducer(withUpload(), { type: 'uploaded', key: 'k1', document: doc(), duplicate: false });
    s = sessionReducer(s, { type: 'event', event: { type: 'removed', id: 'doc_1' } });
    expect(rowView(s, s.rows[0]!)).toMatchObject({ label: 'Deleted', meta: 'Deleted from the library.' });
  });
});

describe('sessionSummary', () => {
  it('counts ready files and files still in progress', () => {
    let s = sessionReducer(initialSession, {
      type: 'added',
      files: [
        { key: 'a', name: 'a.md', sizeBytes: 1 },
        { key: 'b', name: 'b.md', sizeBytes: 1 },
        { key: 'c', name: 'c.md', sizeBytes: 1 },
        { key: 'd', name: 'd.exe', sizeBytes: 1, error: 'no' },
      ],
    });
    s = sessionReducer(s, {
      type: 'uploaded',
      key: 'a',
      document: doc({ id: 'x', status: 'ready' }),
      duplicate: false,
    });
    s = sessionReducer(s, { type: 'uploaded', key: 'b', document: doc({ id: 'y' }), duplicate: false });
    expect(sessionSummary(s)).toBe('1 ready, 2 in progress');
  });
});
