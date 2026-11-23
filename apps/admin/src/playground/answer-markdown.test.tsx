import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnswerMarkdown } from './answer-markdown';

const html = (text: string, opts: { ranks?: number[]; streaming?: boolean } = {}) =>
  renderToStaticMarkup(
    <AnswerMarkdown
      text={text}
      ranks={opts.ranks ?? [1, 2]}
      streaming={opts.streaming ?? false}
      renderCitation={(rank) => <b data-cite={rank} />}
    />,
  );

describe('AnswerMarkdown', () => {
  it('renders bold, lists and paragraphs instead of showing the asterisks', () => {
    const out = html('First, a **declarative stage**.\n\n- one\n- two');
    expect(out).toContain('<strong>declarative stage</strong>');
    expect(out).toContain('<li>one</li>');
    expect(out).not.toContain('**');
  });

  it('renders GitHub tables', () => {
    expect(html('| a | b |\n| - | - |\n| 1 | 2 |')).toContain('<table>');
  });

  it('turns cited markers into citations, inside formatting too', () => {
    const out = html('It retrieves [1] and **generates [2]**.');
    expect(out).toContain('retrieves <b data-cite="1"></b> and');
    expect(out).toContain('<strong>generates <b data-cite="2"></b></strong>');
  });

  it('keeps a marker with no citation, or one in code, as text', () => {
    const out = html('See [9]. Code: `items[1]`\n\n```\nx[1]\n```', { ranks: [1] });
    expect(out).toContain('See [9].');
    expect(out).toContain('<code>items[1]</code>');
    expect(out).toContain('x[1]');
    expect(out).not.toContain('data-cite');
  });

  it('shows raw HTML as text and never as markup', () => {
    const out = html('Hi <img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
  });

  it('drops javascript: links and opens real ones in a new tab', () => {
    expect(html('[x](javascript:alert(1))')).not.toContain('javascript:');
    expect(html('[docs](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer">docs</a>',
    );
  });

  it('puts the caret at the end of the last paragraph while streaming', () => {
    const out = html('One.\n\nTwo', { streaming: true });
    expect(out).toMatch(/Two<span data-testid="caret"[^>]*><\/span><\/p>$/);
    expect(html('Two')).not.toContain('caret');
  });
});
