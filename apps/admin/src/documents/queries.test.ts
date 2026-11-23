import type { Document } from '@rag/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { applyToLibrary, documentsKey } from './queries';

function doc(id: string, over: Partial<Document> = {}): Document {
  return {
    id,
    workspace: 'ouc',
    folderId: null,
    title: id,
    fileName: `${id}.md`,
    type: 'md',
    sizeBytes: 10,
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

describe('applyToLibrary', () => {
  it('patches the cached list with document and removed events', () => {
    const client = new QueryClient();
    client.setQueryData(documentsKey('ouc'), [doc('a'), doc('b')]);
    applyToLibrary(client, 'ouc', { type: 'document', document: doc('c') });
    applyToLibrary(client, 'ouc', { type: 'removed', id: 'a' });
    expect(client.getQueryData<Document[]>(documentsKey('ouc'))!.map((d) => d.id)).toEqual(['c', 'b']);
    expect(client.getQueryState(documentsKey('ouc'))!.isInvalidated).toBe(false);
  });

  it('reloads the list on every snapshot, so changes missed while disconnected or loading show', async () => {
    const client = new QueryClient();
    client.setQueryData(documentsKey('ouc'), [doc('a')]);
    await applyToLibrary(client, 'ouc', { type: 'snapshot', documents: [] });
    expect(client.getQueryState(documentsKey('ouc'))!.isInvalidated).toBe(true);
  });
});
