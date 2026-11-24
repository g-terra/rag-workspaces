/** Code and math, where `[n]` is never a citation. */
const VERBATIM =
  /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/;

/**
 * One citation, `[4]` or `【4†L3】`. Up to two digits (a search returns at most 50 passages), so `[1974]` is
 * text. Lists are left alone: `[0, 1]` is as likely an interval.
 */
const ONE = /\[([1-9]\d?)\]|【([1-9]\d?)(?:†[^】【\n]{0,40})?】/g;
const RUN = `(?:${ONE.source})+`;

/** A word before `[n]` that makes it part of the sentence: "The vector is [5].", "See [4] and [5]." */
const LEADS_IN = /\b(?:is|are|was|and|or|see|in|from|of|to|returns?|passages?|equals?)$/i;

/**
 * Citations where a statement ends: after a word or its punctuation and a space, before punctuation or the
 * end of the line. Anywhere else `[n]` may be a value, an index or a reference, and is left alone.
 */
const AT_END = new RegExp(
  String.raw`(?<=[\p{L}\p{N}.,;:!?)%"”’*])([ \t]{1,3})(${RUN})(?=[.,;:!?](?:\s|$)|[ \t]*(?:\n|$))`,
  'gu',
);

/** A last line of nothing but citations. */
const LAST_LINE = new RegExp(String.raw`\n{1,3}(${RUN})\s{0,3}$`, 'u');

/**
 * A model's reply without citations to passages it has none for (`ranks`). The number is removed, never
 * swapped for another: a wrong guess would look like evidence. In doubt the text is kept.
 */
export function dropUnknownCitations(text: string, ranks: number[]): string {
  const known = (run: string) =>
    [...run.matchAll(ONE)]
      .filter((m) => ranks.includes(Number(m[1] ?? m[2])))
      .map((m) => m[0])
      .join('');
  const prose = (part: string) =>
    part.replace(AT_END, (marker: string, space: string, run: string, ...rest) => {
      const at = rest.find((r) => typeof r === 'number') as number;
      if (LEADS_IN.test(part.slice(Math.max(0, at - 20), at))) return marker;
      const kept = known(run);
      return kept && space + kept;
    });
  return text
    .split(VERBATIM)
    .map((part, i) => (i % 2 ? part : prose(part)))
    .join('')
    .replace(LAST_LINE, (line: string, run: string) => {
      const kept = known(run);
      return kept && line.replace(run, kept);
    });
}
