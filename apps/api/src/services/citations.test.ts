import { describe, expect, it } from 'vitest';
import { dropUnknownCitations } from './citations.js';

describe('dropUnknownCitations', () => {
  it.each([
    [
      'a number past the passages',
      'An epoch is one pass [1]. It is a full pass [4].',
      'An epoch is one pass [1]. It is a full pass.',
    ],
    ['next to a real one', 'One pass [1][4], then another [4][2].', 'One pass [1], then another [2].'],
    ['fullwidth', 'One pass 【7†L3-L5】.', 'One pass.'],
    ['on a line of its own', 'One pass [1].\n\n[4]', 'One pass [1].'],
    ['before a word', 'A pass [4] is an epoch [1].', 'A pass is an epoch [1].'],
    ['two in a row', 'One pass [4][5].', 'One pass.'],
  ])('removes a citation to a passage that was not given: %s', (_, text, expected) => {
    expect(dropUnknownCitations(text, [1, 2, 3])).toBe(expected);
  });

  it.each([
    ['real citations', 'One pass [1][3].'],
    ['a list', 'The sigmoid gives values in [0, 1], and the search runs over [5, 10].'],
    ['an index', 'The first is items[7], then rows[2][9].'],
    ['a year', 'Baddeley and Hitch [1974] proposed it [1].'],
    ['zero', 'It returns [0] at the start [1].'],
    ['inline code', 'Use `x = [7]` to start [1].'],
    ['a code block', 'Like this [1]:\n\n```python\nx = [7]\n```'],
    ['a link', 'See [7](http://example.com) [1].'],
    ['a reply that is only a citation', '[7]'],
  ])('keeps %s', (_, text) => {
    expect(dropUnknownCitations(text, [1, 2, 3])).toBe(text);
  });
});
