/** Code and math, closed or not, where `[n]` is never a citation. The last two: indented code, table rows. */
const VERBATIM = new RegExp(
  [
    String.raw`(\`{3,}|~{3,})[\s\S]*?(?:\1|$)`,
    String.raw`\`[^\`\n]*\`?`,
    String.raw`\$\$[\s\S]*?(?:\$\$|$)`,
    String.raw`\$[^$\n]+\$`,
    String.raw`\\\([\s\S]*?(?:\\\)|$)`,
    String.raw`\\\[[\s\S]*?(?:\\\]|$)`,
    String.raw`(?<![^\n])(?: {4}|\t)(?![ \t]*(?:[-*+]|\d{1,3}[.)])[ \t])[^\n]*`,
    String.raw`(?<![^\n])[^\n|]*\|[ \t][^\n]*`,
  ].join('|'),
  'g',
);

/**
 * One citation, `[4]` or `【4†L3】`. Up to two digits (a search returns at most 50 passages), so `[1974]` is
 * text. Lists are left alone: `[0, 1]` is as likely an interval.
 */
const ONE = /\[([1-9]\d?)\]|【([1-9]\d?)(?:†[^】【\n]{0,40})?】/g;

/**
 * Citations where a statement ends: after a word and before punctuation or the end of the line, or after a
 * full stop and before the end of the line. Anywhere else `[n]` may be a value, an index or a reference.
 */
const AT_END = new RegExp(
  String.raw`(?:(?<=\p{L}{3})|(?<=\p{L}{4}[.!?])(?=[^\n.,;:!?]{1,40}(?:\n|$))|(?<=\p{L}\*\*))[ \t]{1,3}` +
    String.raw`((?:${ONE.source})+)(?=[.;:!?](?:\s|$)|,(?!\s*[[【])\s|[ \t]*(?:\n|$))`,
  'gu',
);

/** A word before `[n]` that makes it part of the sentence: "The vector is [5].", "See [4]." */
const LEADS_IN =
  /\b(?:are|was|and|see|from|cite|returns?|gives?|outputs?|prints?|vector|array|list|values?|passages?|equals?)$/i;

/**
 * A model's reply without citations to passages it has none for (`ranks`). The number is removed, never
 * swapped for another: a wrong guess would look like evidence. In doubt the text is kept.
 */
export function dropUnknownCitations(text: string, ranks: number[]): string {
  const verbatim = [...text.matchAll(VERBATIM)].map((m) => [m.index, m.index + m[0].length] as const);
  let next = 0;
  return text.replace(AT_END, (marker: string, run: string, ...rest) => {
    const at = rest.find((r) => typeof r === 'number') as number;
    while (next < verbatim.length && verbatim[next]![1] <= at) next++;
    if (next < verbatim.length && verbatim[next]![0] <= at) return marker;
    if (LEADS_IN.test(text.slice(Math.max(0, at - 20), at))) return marker;
    const kept = [...run.matchAll(ONE)].filter((m) => ranks.includes(Number(m[1] ?? m[2])));
    return kept.length ? marker.replace(run, kept.map((m) => m[0]).join('')) : '';
  });
}
