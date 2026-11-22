import type { Document } from '@rag/shared';
import { describe, expect, it } from 'vitest';
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

function withUpload(): SessionState {
  return sessionReducer(initialSession, {
    type: 'added',
    files: [{ key: 'k1', name: 'notes.md', sizeBytes: 2048 }],
  });
}

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
    });
  });

  it('shows a duplicate as skipped, whatever the existing document does', () => {
    const s = sessionReducer(withUpload(), {
      type: 'uploaded',
      key: 'k1',
      document: doc({ status: 'ready' }),
      duplicate: true,
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
});

describe('sessionSummary', () => {
  it('counts uploaded files and files still uploading', () => {
    let s = sessionReducer(initialSession, {
      type: 'added',
      files: [
        { key: 'a', name: 'a.md', sizeBytes: 1 },
        { key: 'b', name: 'b.md', sizeBytes: 1 },
        { key: 'c', name: 'c.md', sizeBytes: 1 },
        { key: 'd', name: 'd.exe', sizeBytes: 1, error: 'no' },
      ],
    });
    s = sessionReducer(s, { type: 'uploaded', key: 'a', document: doc({ id: 'x' }), duplicate: false });
    s = sessionReducer(s, { type: 'uploaded', key: 'b', document: doc({ id: 'y' }), duplicate: true });
    expect(sessionSummary(s)).toBe('1 uploaded, 1 uploading');
  });
});
