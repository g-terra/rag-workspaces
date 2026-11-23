import { isSupported } from './files';

/** A file to upload, with its path inside what was picked or dropped (`COS512/Week 1/intro.pdf`). */
export interface PickedFile {
  file: File;
  path: string;
}

/**
 * The parts of the File and Directory Entries API the walk uses: `FileSystemFileEntry` and
 * `FileSystemDirectoryEntry`, narrowed so tests can fake them.
 */
export interface EntryLike {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?(ok: (file: File) => void, fail?: (err: unknown) => void): void;
  createReader?(): {
    readEntries(ok: (entries: EntryLike[]) => void, fail?: (err: unknown) => void): void;
  };
}

/** Files from a file input; with `webkitdirectory` each one carries its path inside the chosen folder. */
export function filesFromInput(list: Iterable<File>): PickedFile[] {
  return [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/**
 * Every file under the dropped entries, subfolders included. A directory reader hands its entries out
 * in batches (100 at a time in Chrome), so it is read until it returns none. A file or folder that
 * can't be read is counted in `unreadable` rather than failing the whole drop.
 */
export async function walkEntries(
  entries: EntryLike[],
  parent = '',
): Promise<{ files: PickedFile[]; unreadable: number }> {
  const out = { files: [] as PickedFile[], unreadable: 0 };
  for (const entry of entries) {
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.isFile && entry.file) {
      const read = entry.file.bind(entry);
      const file = await new Promise<File | null>((ok) => read(ok, () => ok(null)));
      if (file) out.files.push({ file, path });
      else out.unreadable++;
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      const children: EntryLike[] = [];
      for (;;) {
        const batch = await new Promise<EntryLike[] | null>((ok) => reader.readEntries(ok, () => ok(null)));
        if (!batch) out.unreadable++;
        if (!batch?.length) break;
        children.push(...batch);
      }
      const inner = await walkEntries(children, path);
      out.files.push(...inner.files);
      out.unreadable += inner.unreadable;
    }
  }
  return out;
}

/** Files an operating system leaves in folders, never material. */
const SYSTEM_FILES = new Set(['thumbs.db', 'desktop.ini']);

export interface UploadPlan {
  /** What to upload, in the order given. */
  files: PickedFile[];
  /** Files in folders that were left out because they can't be indexed, per extension (`.pptx`). */
  skipped: Record<string, number>;
}

/**
 * Decides what a pick or drop uploads. Inside a folder, hidden files, anything under a hidden folder
 * and system files are ignored, and unsupported files are skipped and counted. A file chosen on its
 * own is always kept, so its row can say why it was refused.
 */
export function planUpload(picked: PickedFile[]): UploadPlan {
  const plan: UploadPlan = { files: [], skipped: {} };
  for (const p of picked) {
    const segments = p.path.split('/');
    if (segments.length === 1) {
      plan.files.push(p);
      continue;
    }
    const name = segments.at(-1)!;
    if (segments.some((s) => s.startsWith('.')) || SYSTEM_FILES.has(name.toLowerCase())) continue;
    if (isSupported(name)) plan.files.push(p);
    else {
      const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
      const key = ext ? `.${ext}` : 'no extension';
      plan.skipped[key] = (plan.skipped[key] ?? 0) + 1;
    }
  }
  return plan;
}

/** The skipped counts of the session so far plus those of a new pick. */
export function mergeSkipped(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [ext, n] of Object.entries(b)) out[ext] = (out[ext] ?? 0) + n;
  return out;
}

/**
 * "Skipped 3 files that can't be indexed: 2 .pptx, 1 .zip.", or null when nothing was skipped. The page
 * counts files the browser couldn't read under `unreadable`.
 */
export function skippedSummary(skipped: Record<string, number>): string | null {
  const counts = Object.entries(skipped).sort((a, b) => b[1] - a[1]);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  if (!total) return null;
  const list = counts.map(([ext, c]) => `${c} ${ext}`).join(', ');
  return `Skipped ${total} ${total === 1 ? 'file' : 'files'} that can't be indexed: ${list}.`;
}
