import { describe, expect, it } from 'vitest';
import {
  filesFromInput,
  planUpload,
  skippedSummary,
  walkEntries,
  type EntryLike,
  type PickedFile,
} from './folder-upload';

const file = (name: string, size = 10) => ({ name, size }) as File;
const picked = (path: string): PickedFile => ({ file: file(path.split('/').at(-1)!), path });

describe('planUpload', () => {
  it('keeps supported files, named by their path', () => {
    const plan = planUpload([picked('COS512/intro.pdf'), picked('COS512/Week 1/notes.md')]);
    expect(plan.files.map((f) => f.path)).toEqual(['COS512/intro.pdf', 'COS512/Week 1/notes.md']);
    expect(plan.skipped).toEqual({});
  });

  it('ignores hidden files, anything under a hidden folder, and system files', () => {
    const plan = planUpload([
      picked('COS512/.DS_Store'),
      picked('COS512/.git/config.md'),
      picked('COS512/Thumbs.db'),
      picked('COS512/Week 1/desktop.ini'),
      picked('COS512/a.pdf'),
    ]);
    expect(plan.files.map((f) => f.path)).toEqual(['COS512/a.pdf']);
    expect(plan.skipped).toEqual({});
  });

  it('skips unsupported files inside a folder, counted per extension', () => {
    const plan = planUpload([
      picked('COS512/slides.pptx'),
      picked('COS512/Week 1/more.PPTX'),
      picked('COS512/all.zip'),
      picked('COS512/Makefile'),
      picked('COS512/a.pdf'),
    ]);
    expect(plan.files.map((f) => f.path)).toEqual(['COS512/a.pdf']);
    expect(plan.skipped).toEqual({ '.pptx': 2, '.zip': 1, 'no extension': 1 });
  });

  it('keeps an unsupported file chosen on its own, so its row says why it was refused', () => {
    const plan = planUpload([picked('slides.pptx'), picked('.hidden.md')]);
    expect(plan.files.map((f) => f.path)).toEqual(['slides.pptx', '.hidden.md']);
  });
});

describe('skippedSummary', () => {
  it('is null when nothing was skipped', () => {
    expect(skippedSummary({})).toBeNull();
  });

  it('counts the files, most common extension first', () => {
    expect(skippedSummary({ '.zip': 1, '.pptx': 2 })).toBe(
      "Skipped 3 files that can't be indexed: 2 .pptx, 1 .zip.",
    );
    expect(skippedSummary({ '.zip': 1 })).toBe("Skipped 1 file that can't be indexed: 1 .zip.");
  });
});

describe('filesFromInput', () => {
  it('uses webkitRelativePath, or the name when the input had no folder', () => {
    const inFolder = Object.assign(file('a.pdf'), { webkitRelativePath: 'COS512/a.pdf' });
    const loose = Object.assign(file('b.md'), { webkitRelativePath: '' });
    expect(filesFromInput([inFolder, loose]).map((p) => p.path)).toEqual(['COS512/a.pdf', 'b.md']);
  });
});

/** A fake FileSystemFileEntry. */
const fileEntry = (name: string): EntryLike => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (ok: (f: File) => void) => ok(file(name)),
});

/** A fake FileSystemDirectoryEntry whose reader hands out `batch` entries per call, like Chrome's 100. */
const dirEntry = (name: string, children: EntryLike[], batch = 2): EntryLike => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let at = 0;
    return {
      readEntries: (ok: (entries: EntryLike[]) => void) => {
        const next = children.slice(at, at + batch);
        at += next.length;
        setTimeout(() => ok(next));
      },
    };
  },
});

describe('walkEntries', () => {
  it('walks nested folders, reading each folder until its reader runs dry', async () => {
    const tree = [
      dirEntry('COS512', [
        fileEntry('a.pdf'),
        fileEntry('b.pdf'),
        fileEntry('c.pdf'),
        dirEntry('Week 1', [fileEntry('notes.md')]),
      ]),
      fileEntry('loose.txt'),
    ];
    const paths = (await walkEntries(tree)).map((p) => p.path).sort();
    expect(paths).toEqual([
      'COS512/Week 1/notes.md',
      'COS512/a.pdf',
      'COS512/b.pdf',
      'COS512/c.pdf',
      'loose.txt',
    ]);
  });

  it('skips an entry it cannot read instead of failing the whole drop', async () => {
    const broken: EntryLike = {
      name: 'locked.pdf',
      isFile: true,
      isDirectory: false,
      file: (_ok, fail) => fail?.(new Error('NotReadableError')),
    };
    const paths = (await walkEntries([broken, fileEntry('ok.pdf')])).map((p) => p.path);
    expect(paths).toEqual(['ok.pdf']);
  });
});
