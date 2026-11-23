import type { Document } from '@rag/shared';

/**
 * Where the preview frame points: the file's object URL, with `#page=` so the browser's own PDF viewer
 * (Chrome, Edge, Firefox, Safari) opens on the cited page.
 */
export function previewSrc(objectUrl: string, page: number | null): string {
  return page === null ? objectUrl : `${objectUrl}#page=${page}`;
}

/** Only PDFs: browsers have a viewer for them, and only PDF passages carry a page. */
export function canPreview(type: Document['type']): boolean {
  return type === 'pdf';
}
