import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type FileType = 'pdf' | 'docx' | 'txt' | 'md';

export type StagedFile = {
  /** Absolute path of the temporary file. */
  tmpPath: string;
  sha256: string;
  sizeBytes: number;
};

/** Thrown when a file is larger than the limit; becomes 413. */
export class FileTooLarge extends Error {}

/**
 * Files on the uploads volume, laid out as `<slug>/<document id>.<ext>`. Langflow mounts
 * the same volume read-only and the ingest flow reads the file by that relative path.
 */
export class UploadStorage {
  constructor(
    readonly root: string,
    private readonly maxBytes: number,
  ) {}

  /** Stream an upload to a temp file inside the workspace folder, hashing and counting as it goes. */
  async stage(slug: string, stream: Readable): Promise<StagedFile> {
    const dir = path.join(this.root, slug, '.incoming');
    await mkdir(dir, { recursive: true });
    const tmpPath = path.join(dir, randomUUID());
    const hash = createHash('sha256');
    let size = 0;
    const max = this.maxBytes;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > max) return cb(new FileTooLarge(`larger than ${max} bytes`));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, createWriteStream(tmpPath));
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
    return { tmpPath, sha256: hash.digest('hex'), sizeBytes: size };
  }

  /** Move a staged file to its final place and return the path relative to the volume. */
  async commit(staged: StagedFile, slug: string, documentId: string, type: FileType): Promise<string> {
    const relative = `${slug}/${documentId}.${type}`;
    await rename(staged.tmpPath, path.join(this.root, relative));
    return relative;
  }

  async discard(staged: StagedFile): Promise<void> {
    await rm(staged.tmpPath, { force: true });
  }

  absolute(relative: string): string {
    const full = path.resolve(this.root, relative);
    if (!full.startsWith(path.resolve(this.root) + path.sep))
      throw new Error(`path escapes uploads: ${relative}`);
    return full;
  }

  async remove(relative: string): Promise<void> {
    await rm(this.absolute(relative), { force: true });
  }

  /** Delete a workspace's whole folder. */
  async removeWorkspace(slug: string): Promise<void> {
    await rm(this.absolute(slug), { recursive: true, force: true });
  }

  async exists(relative: string): Promise<boolean> {
    return stat(this.absolute(relative)).then(
      () => true,
      () => false,
    );
  }

  /** The first bytes of a file, for type detection. */
  async head(file: string, bytes = 4096): Promise<Buffer> {
    const fh = await open(file, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }
}

/**
 * Decide the type from the content and the name together, so a renamed binary is not
 * accepted as text and a PDF is a PDF whatever it is called. `null` means unsupported.
 */
export function detectType(fileName: string, head: Buffer): FileType | null {
  const ext = path.extname(fileName).toLowerCase();
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // DOCX is a zip archive; other zip formats (xlsx, odt, plain zip) are refused by the extension.
  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    return ext === '.docx' ? 'docx' : null;
  if (ext === '.md' || ext === '.markdown' || ext === '.txt')
    return looksLikeText(head) ? (ext === '.txt' ? 'txt' : 'md') : null;
  return null;
}

/** No NUL bytes and valid UTF-8 (allowing a character cut off at the end of the sample). */
function looksLikeText(head: Buffer): boolean {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 3)));
    return true;
  } catch {
    return false;
  }
}
