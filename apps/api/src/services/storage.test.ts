import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { FileTooLarge, UploadStorage, detectType } from './storage.js';

const samples = path.resolve(import.meta.dirname, '../../../../poc/samples');

describe('detectType', () => {
  it('recognises the sample files by content', async () => {
    const head = async (f: string) => (await readFile(path.join(samples, f))).subarray(0, 4096);
    expect(detectType('cos512-notes.pdf', await head('ouc/cos512-notes.pdf'))).toBe('pdf');
    expect(detectType('brief.docx', await head('ouc/assignment-brief.docx'))).toBe('docx');
    expect(detectType('tips.md', await head('ouc/langflow-tips.md'))).toBe('md');
    expect(detectType('recipes.txt', await head('personal/recipes.txt'))).toBe('txt');
  });

  it('recognises video and audio by their headers', () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]);
    expect(detectType('lecture.mp4', mp4)).toBe('mp4');
    expect(detectType('lecture.mov', mp4)).toBe('mp4');
    expect(detectType('talk.mp3', Buffer.from('ID3\x04\x00', 'latin1'))).toBe('mp3');
    expect(detectType('talk.mp3', Buffer.from([0xff, 0xfb, 0x90, 0x64]))).toBe('mp3');
    expect(detectType('memo.wav', Buffer.from('RIFF\x24\x08\x00\x00WAVEfmt ', 'latin1'))).toBe('wav');
    // RIFF that isn't WAVE (AVI), and a frame-sync byte pair inside a file not named .mp3.
    expect(detectType('clip.avi', Buffer.from('RIFF\x24\x08\x00\x00AVI LIST', 'latin1'))).toBeNull();
    expect(detectType('data.bin', Buffer.from([0xff, 0xfb, 0x90, 0x64]))).toBeNull();
  });

  it('trusts content over the name for PDFs', () => {
    expect(detectType('renamed.txt', Buffer.from('%PDF-1.7\n'))).toBe('pdf');
  });

  it('refuses binaries named as text, other zip formats and unknown types', () => {
    expect(detectType('evil.txt', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]))).toBeNull();
    expect(detectType('sheet.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBeNull();
    expect(detectType('image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(
      detectType('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x61, 0x62, 0x63])),
    ).toBeNull();
  });
});

describe('UploadStorage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'uploads-'));
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('stages with hash and size, then commits to <slug>/<id>.<ext>', async () => {
    const storage = new UploadStorage(root, 1024);
    const staged = await storage.stage('ouc', Readable.from([Buffer.from('hello')]));
    expect(staged.sizeBytes).toBe(5);
    expect(staged.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    const rel = await storage.commit(staged, 'ouc', 'doc_1', 'txt');
    expect(rel).toBe('ouc/doc_1.txt');
    expect(await readFile(path.join(root, rel), 'utf8')).toBe('hello');
  });

  it('stops at the size limit and leaves no temp file', async () => {
    const storage = new UploadStorage(root, 4);
    await expect(storage.stage('ouc', Readable.from([Buffer.from('too long')]))).rejects.toBeInstanceOf(
      FileTooLarge,
    );
  });

  it('refuses paths that escape the volume', () => {
    expect(() => new UploadStorage(root, 1).absolute('../etc/passwd')).toThrow(/escapes/);
  });
});
