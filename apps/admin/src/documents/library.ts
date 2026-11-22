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

/** "just now", "5 min ago", "3 h ago" within a day; then "3 Nov", with the year if it isn't this one. */
export function formatUpdated(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return then.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

export function shortSha(sha: string): string {
  return `${sha.slice(0, 4)}…${sha.slice(-4)}`;
}

/** The file name in a `content-disposition` header (`filename*=UTF-8''…` or `filename="…"`). */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}
