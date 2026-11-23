import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TranscriptView } from './transcript-view';

describe('TranscriptView', () => {
  it('lists each segment with the time it starts at', () => {
    const html = renderToStaticMarkup(
      <TranscriptView
        transcript={{
          language: 'en',
          segments: [
            { start: 0, end: 3.2, text: 'Welcome to week one.' },
            { start: 754.2, end: 760, text: 'Retrieval comes first.' },
          ],
        }}
      />,
    );
    expect(html).toContain('0:00');
    expect(html).toContain('Welcome to week one.');
    expect(html).toContain('12:34');
    expect(html).toContain('Retrieval comes first.');
  });

  it('says so when Whisper heard nothing', () => {
    const html = renderToStaticMarkup(<TranscriptView transcript={{ language: null, segments: [] }} />);
    expect(html).toContain('No speech was found in this recording.');
  });
});
