import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Transcript } from '@rag/shared';

export type FileType = 'pdf' | 'docx' | 'txt' | 'md' | MediaType;
export type MediaType = 'mp4' | 'mp3' | 'wav';

/** `<slug>/<id>.mp4` → `<slug>/<id>.mp4.transcript.json`; the ingest flow's loader reads that file. */
export const transcriptPath = (relative: string) => `${relative}.transcript.json`;

/** Video and audio go through Whisper before the ingest flow. */
export const isMedia = (type: string): type is MediaType =>
  type === 'mp4' || type === 'mp3' || type === 'wav';

export type StagedFile = {
  /** Absolute path of the temporary file. */
  tmpPath: string;
  sha256: string;
  sizeBytes: number;
};

export type PageFile = { storagePath: string; sha256: string; sizeBytes: number };

/** Hex SHA-256, the checksum documents are deduplicated by. */
export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

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

  /** Delete a file, and the transcript next to it if there is one. */
  async remove(relative: string): Promise<void> {
    await rm(this.absolute(relative), { force: true });
    await rm(this.absolute(transcriptPath(relative)), { force: true });
  }

  /**
   * Write a website page's Markdown as `<slug>/<document id>.md`, replacing any earlier version in one
   * step (written to a temp file, then renamed), so a reader never sees half a page.
   */
  async writePage(slug: string, documentId: string, markdown: string): Promise<PageFile> {
    const storagePath = `${slug}/${documentId}.md`;
    const body = Buffer.from(markdown, 'utf8');
    await mkdir(path.join(this.root, slug), { recursive: true });
    const tmp = path.join(this.root, slug, `.${documentId}.${randomUUID()}.tmp`);
    await writeFile(tmp, body);
    await rename(tmp, this.absolute(storagePath));
    return { storagePath, sha256: sha256(body), sizeBytes: body.length };
  }

  /** Write a document's transcript next to its file, where the ingest flow reads it. */
  async writeTranscript(relative: string, transcript: Transcript): Promise<string> {
    const target = transcriptPath(relative);
    await writeFile(this.absolute(target), JSON.stringify(transcript));
    return target;
  }

  /** A document's transcript, or null when it has none (not video or audio, or not transcribed yet). */
  async readTranscript(relative: string): Promise<Transcript | null> {
    try {
      return JSON.parse(await readFile(this.absolute(transcriptPath(relative)), 'utf8')) as Transcript;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
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
  if (head.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4'; // MP4, M4A and MOV share it
  if (head.subarray(0, 4).toString('latin1') === 'RIFF')
    return head.subarray(8, 12).toString('latin1') === 'WAVE' ? 'wav' : null;
  if (head.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3';
  // A bare MPEG audio frame header is only two bytes, so it needs the name to agree.
  if (ext === '.mp3' && head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) return 'mp3';
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
