import { describe, expect, it } from 'vitest';
import { dropUnknownCitations } from './citations.js';

describe('dropUnknownCitations', () => {
  it.each([
    ['at the end of a sentence', 'One pass [1]. A full pass [4].', 'One pass [1]. A full pass.'],
    ['next to a real one', 'One pass [1][4], then another [4][2].', 'One pass [1], then another [2].'],
    ['fullwidth', 'One pass 【7†L3-L5】.', 'One pass.'],
    ['after the full stop', 'One pass. [4]\n\nNext [1].', 'One pass.\n\nNext [1].'],
    ['at the end of a list item', '- **Goal**: safe [4]\n- Sensors [1]', '- **Goal**: safe\n- Sensors [1]'],
    [
      'in text around math',
      'Let $x$ be one pass [4]. Then `f` is called again [5].',
      'Let $x$ be one pass. Then `f` is called again.',
    ],
    ['two in a row', 'One pass [4][5].', 'One pass.'],
  ])('removes a citation to a passage with no citation: %s', (_, text, expected) => {
    expect(dropUnknownCitations(text, [1, 2, 3])).toBe(expected);
  });

  it.each([
    ['real citations', 'One pass [1][3].'],
    ['lists and intervals', 'Values in [0, 1], searched over [5, 10].'],
    ['indexes', 'First items[7], then rows[2][9], items()[7], d["k"][7].'],
    ['years', 'Proposed in psychology [1974].'],
    ['zero', 'It starts at zero [0].'],
    ['values', 'The vector is [5]. Then x = [7].\nf([7])'],
    ['the middle of a sentence', 'The passage [4] says so. Doe et al. [14] agree. See [4] and [5].'],
    ['inline code', 'Use `x then [7]`.'],
    ['code blocks', '```\nx then [7]\n```\n\n~~~\nx then [7]\n~~~'],
    ['math', 'Let $a + b [7]$ and $$\na [7]\n$$ and \\(a [7]\\) and \\[ a [7] \\].'],
    ['links', 'See this [7](http://example.com), [text][7], [[7]].\n\n[7]: http://example.com'],
    ['a list of sources', 'Sources\n[4] A book\n[5] A paper'],
    ['line breaks', '# Title\n\n[7] A para.  \n[4] Next'],
    ['brackets around it', 'It is so ([7]) and **[7]**.'],
    ['a table cell', '| a | [7] |'],
    ['text before math or code', 'Scale factor [5] $x$ by two. Cite [7] \\(x\\) here.'],
    ['a last line of its own', 'Output here:\n\n[5]'],
    ['comma-separated citations', 'A pass [1], [7]. A pass [7], [8].'],
    [
      'operators, labels and numbers',
      'compute 2 * [7].\n10 % [7].\nAnswer: [5]\n1. [7]\n2. [8]\nAs in eq. [5].\nO(n) [7].',
    ],
    ['indented code and loose tables', '    x = foo [7]\n\nname | word [7]'],
    [
      'nested and unclosed code or math',
      '````\n```\nword [7]\n```\nword [7]\n````\n\nRun `word [7].\n\n$$\nword [7].',
    ],
    ['an unclosed fence', 'Code:\n```\nword [7]\n[7]'],
    ['an unclosed display formula', 'Math: \\[\nword [7]'],
    ['a reply that is only citations', '[4][5]'],
  ])('keeps %s', (_, text) => {
    expect(dropUnknownCitations(text, [1, 2, 3])).toBe(text);
  });

  it.each([
    ' '.repeat(50_000),
    '\n'.repeat(50_000),
    '[7]'.repeat(20_000) + '(',
    '【7†'.repeat(20_000),
    '$'.repeat(50_001),
  ])('is quick on a degenerate reply', (text) => {
    const started = performance.now();
    dropUnknownCitations(`a${text}`, [1]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
