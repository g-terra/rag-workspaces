import type { Document } from '@rag/shared';

export type DocumentStatus = Document['status'];

/** For the file input's `accept`. The API checks the content too; this only saves a pointless upload. */
export const ACCEPT = '.pdf,.docx,.txt,.md';
/** The API's and nginx's default `MAX_UPLOAD_BYTES`. A larger limit on the server still answers 413 here. */
const MAX_BYTES = 200 * 1024 * 1024;

const UNSUPPORTED = 'Not a supported file. Use PDF, DOCX, TXT or MD.';
const TOO_LARGE = 'Too large: the limit is 200 MB per file.';

/** Why this file can't be uploaded, or null when it can. */
export function checkFile(file: { name: string; size: number }): string | null {
  const ext = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase();
  if (!ext || !ACCEPT.split(',').includes(`.${ext}`)) return UNSUPPORTED;
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_BYTES) return TOO_LARGE;
  return null;
}

/** A failed upload in words. `status` 0 means the request never got an answer. */
export function uploadErrorMessage(status: number, detail: string): string {
  if (status === 413) return TOO_LARGE;
  if (status === 415) return UNSUPPORTED;
  if (status === 403) return "You can't upload to this workspace.";
  if (status === 0) return "Couldn't reach the API. Check your connection and try again.";
  if (status === 400) return detail;
  return `Upload failed: ${detail}`;
}

export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  const shown = i > 0 && n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n).toString();
  return `${shown} ${units[i]}`;
}

const LABELS: Record<DocumentStatus, string> = {
  queued: 'Queued',
  transcribing: 'Transcribing',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

export function statusLabel(status: DocumentStatus): string {
  return LABELS[status];
}
