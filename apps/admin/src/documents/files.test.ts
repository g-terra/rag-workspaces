import { describe, expect, it } from 'vitest';
import { checkFile, formatBytes, statusLabel, uploadErrorMessage } from './files';

describe('checkFile', () => {
  it('accepts PDF, DOCX, TXT and MD, whatever the case of the extension', () => {
    for (const name of ['a.pdf', 'b.DOCX', 'notes.txt', 'README.Md'])
      expect(checkFile({ name, size: 10 })).toBeNull();
  });

  it('refuses other types and names without an extension', () => {
    expect(checkFile({ name: 'slides.pptx', size: 10 })).toBe(
      'Not a supported file. Use PDF, DOCX, TXT or MD.',
    );
    expect(checkFile({ name: 'Makefile', size: 10 })).toBe('Not a supported file. Use PDF, DOCX, TXT or MD.');
  });

  it('refuses empty files and files over 2 GB', () => {
    expect(checkFile({ name: 'a.md', size: 0 })).toBe('The file is empty.');
    expect(checkFile({ name: 'a.pdf', size: 2 * 1024 ** 3 })).toBeNull();
    expect(checkFile({ name: 'a.pdf', size: 2 * 1024 ** 3 + 1 })).toBe(
      'Too large: the limit is 2 GB per file.',
    );
  });
});

describe('uploadErrorMessage', () => {
  it('puts 413 and 415 in words', () => {
    // The server's own limit may be lower than the default, so its words win.
    expect(uploadErrorMessage(413, '"a.pdf" is larger than the upload limit of 500 MB.')).toBe(
      'Too large: "a.pdf" is larger than the upload limit of 500 MB.',
    );
    expect(uploadErrorMessage(413, '')).toBe('Too large: the limit is 2 GB per file.');
    expect(uploadErrorMessage(415, 'x')).toBe('Not a supported file. Use PDF, DOCX, TXT or MD.');
  });

  it('explains a refused role and a network failure', () => {
    expect(uploadErrorMessage(403, 'Forbidden')).toBe("You can't upload to this workspace.");
    expect(uploadErrorMessage(0, '')).toBe("Couldn't reach the API. Check your connection and try again.");
  });

  it("shows the API's detail for anything else", () => {
    expect(uploadErrorMessage(400, '"a.md" is empty.')).toBe('"a.md" is empty.');
    expect(uploadErrorMessage(502, 'Bad Gateway')).toBe('Upload failed: Bad Gateway');
  });
});

describe('formatBytes', () => {
  it('uses B, KB, MB and GB with one decimal under ten', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4 MB');
    expect(formatBytes(412 * 1024 * 1024)).toBe('412 MB');
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB');
  });
});

describe('statusLabel', () => {
  it('names every status', () => {
    expect(
      ['queued', 'transcribing', 'processing', 'ready', 'failed'].map((s) => statusLabel(s as never)),
    ).toEqual(['Queued', 'Transcribing', 'Processing', 'Ready', 'Failed']);
  });
});
