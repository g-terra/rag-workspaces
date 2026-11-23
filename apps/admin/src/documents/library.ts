import type { Document } from '@rag/shared';
import type { DocumentEvent } from './events';
import { formatBytes } from './files';

/** Puts a document into the list: in place if known (unless the list holds a newer copy), else first. */
function upsert(list: Document[], d: Document): Document[] {
  const i = list.findIndex((x) => x.id === d.id);
  if (i < 0) return [d, ...list];
  if (list[i]!.updatedAt > d.updatedAt) return list;
  return list.with(i, d);
}

/** The library list after one event from the status stream. */
export function applyDocumentEvent(list: Document[], event: DocumentEvent): Document[] {
  if (event.type === 'removed') return list.filter((d) => d.id !== event.id);
  if (event.type === 'document') return upsert(list, event.document);
  // The snapshot is newest first; adding its oldest first leaves new documents newest on top.
  return event.documents.toReversed().reduce(upsert, list);
}

export type StatusTab = 'all' | 'ready' | 'active' | 'failed';

export const TABS: [StatusTab, string][] = [
  ['all', 'All'],
  ['ready', 'Ready'],
  ['active', 'In progress'],
  ['failed', 'Failed'],
];

export function filterDocuments(list: Document[], tab: StatusTab, search: string): Document[] {
  const q = search.trim().toLowerCase();
  return list.filter((d) => {
    const inTab =
      tab === 'all' || (tab === 'active' ? !['ready', 'failed'].includes(d.status) : d.status === tab);
    return inTab && (!q || d.title.toLowerCase().includes(q));
  });
}

const plural = (n: number, word: string) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;

/** "42 documents · 5,120 passages · 1.2 GB", from the list. */
export function librarySummary(list: Document[]): string {
  const passages = list.reduce((n, d) => n + (d.passageCount ?? 0), 0);
  const bytes = list.reduce((n, d) => n + d.sizeBytes, 0);
  return `${plural(list.length, 'document')} · ${plural(passages, 'passage')} · ${formatBytes(bytes)}`;
}

export function shortSha(sha: string): string {
  return `${sha.slice(0, 4)}…${sha.slice(-4)}`;
}

/** Whether the ingest flow is working on it now; the API refuses Reindex and Delete (`409`) meanwhile. */
export function isIngesting(doc: Document): boolean {
  return doc.status === 'processing' || doc.status === 'transcribing';
}
