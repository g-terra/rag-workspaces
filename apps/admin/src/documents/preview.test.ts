import { describe, expect, it } from 'vitest';
import { canPreview, previewSrc } from './preview';

describe('previewSrc', () => {
  it('opens the browser’s PDF viewer on the cited page', () => {
    expect(previewSrc('blob:http://x/abc', 12)).toBe('blob:http://x/abc#page=12');
  });

  it('opens on the first page when no page is known', () => {
    expect(previewSrc('blob:http://x/abc', null)).toBe('blob:http://x/abc');
  });
});

describe('canPreview', () => {
  it('previews PDFs only', () => {
    expect(canPreview('pdf')).toBe(true);
    expect(canPreview('docx')).toBe(false);
    expect(canPreview('md')).toBe(false);
    expect(canPreview('txt')).toBe(false);
  });
});
