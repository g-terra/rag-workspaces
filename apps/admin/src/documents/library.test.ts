import type { Document } from '@rag/shared';
import { describe, expect, it } from 'vitest';
import {
  applyDocumentEvent,
  filenameFromDisposition,
  filterDocuments,
  formatUpdated,
  librarySummary,
  shortSha,
} from './library';

function doc(id: string, over: Partial<Document> = {}): Document {
  return {
    id,
    workspace: 'ouc',
    title: id,
    fileName: `${id}.md`,
    type: 'md',
    sizeBytes: 1024,
    sha256: '9f2c'.padEnd(60, '0') + '4b1e',
    status: 'ready',
    attempts: 1,
    error: null,
    passageCount: 10,
    tags: [],
    createdAt: '2026-11-22T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    ...over,
  };
}

describe('applyDocumentEvent', () => {
  const list = [doc('b'), doc('a')];

  it('puts a new document first and replaces a known one in place', () => {
    expect(applyDocumentEvent(list, { type: 'document', document: doc('c') }).map((d) => d.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
    const changed = applyDocumentEvent(list, {
      type: 'document',
      document: doc('a', { status: 'queued', updatedAt: '2026-11-22T10:00:05.000Z' }),
    });
    expect(changed.map((d) => [d.id, d.status])).toEqual([
      ['b', 'ready'],
      ['a', 'queued'],
    ]);
  });

  it('keeps the newer copy when an older one arrives', () => {
    const newer = [doc('a', { status: 'ready', updatedAt: '2026-11-22T10:00:09.000Z' })];
    const older = doc('a', { status: 'processing', updatedAt: '2026-11-22T10:00:01.000Z' });
    expect(applyDocumentEvent(newer, { type: 'document', document: older })[0]!.status).toBe('ready');
  });

  it('merges a snapshot and drops removed documents', () => {
    const snap = applyDocumentEvent(list, {
      type: 'snapshot',
      documents: [
        doc('c', { status: 'queued' }),
        doc('a', { status: 'processing', updatedAt: '2026-11-22T11:00:00.000Z' }),
      ],
    });
    expect(snap.map((d) => [d.id, d.status])).toEqual([
      ['c', 'queued'],
      ['b', 'ready'],
      ['a', 'processing'],
    ]);
    expect(applyDocumentEvent(list, { type: 'removed', id: 'b' }).map((d) => d.id)).toEqual(['a']);
  });
});

describe('filterDocuments', () => {
  const list = [
    doc('Week 7 slides', { status: 'ready' }),
    doc('Lecture notes', { status: 'processing' }),
    doc('Handout', { status: 'failed' }),
    doc('Reading', { status: 'queued' }),
  ];
  const titles = (tab: Parameters<typeof filterDocuments>[1], q = '') =>
    filterDocuments(list, tab, q).map((d) => d.title);

  it('filters by status tab', () => {
    expect(titles('all')).toHaveLength(4);
    expect(titles('ready')).toEqual(['Week 7 slides']);
    expect(titles('active')).toEqual(['Lecture notes', 'Reading']);
    expect(titles('failed')).toEqual(['Handout']);
  });

  it('searches titles, ignoring case and outer spaces', () => {
    expect(titles('all', '  WEEK ')).toEqual(['Week 7 slides']);
    expect(titles('ready', 'notes')).toEqual([]);
  });
});

describe('librarySummary', () => {
  it('counts documents, passages and bytes', () => {
    expect(librarySummary([doc('a'), doc('b', { passageCount: null, sizeBytes: 2048 })])).toBe(
      '2 documents · 10 passages · 3 KB',
    );
    expect(librarySummary([doc('a', { passageCount: 1 })])).toBe('1 document · 1 passage · 1 KB');
  });
});

describe('formatUpdated', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  it('is relative within a day, then a short date', () => {
    expect(formatUpdated('2026-11-22T11:59:30Z', now)).toBe('just now');
    expect(formatUpdated('2026-11-22T11:58:00Z', now)).toBe('2 min ago');
    expect(formatUpdated('2026-11-22T09:00:00Z', now)).toBe('3 h ago');
    expect(formatUpdated('2026-11-03T09:00:00Z', now)).toBe('3 Nov');
    expect(formatUpdated('2025-10-20T09:00:00Z', now)).toBe('20 Oct 2025');
  });
});

describe('shortSha', () => {
  it('keeps the first and last four characters', () => {
    expect(shortSha(doc('a').sha256)).toBe('9f2c…4b1e');
  });
});

describe('filenameFromDisposition', () => {
  it("reads the API's RFC 5987 form", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''Week%207%20notes%20%C3%A9.md")).toBe(
      'Week 7 notes é.md',
    );
  });

  it('reads a plain quoted filename, and gives null without one', () => {
    expect(filenameFromDisposition('attachment; filename="a b.pdf"')).toBe('a b.pdf');
    expect(filenameFromDisposition('attachment')).toBeNull();
    expect(filenameFromDisposition(null)).toBeNull();
  });
});
