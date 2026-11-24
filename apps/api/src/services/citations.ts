/** Code, where `[n]` is never a citation: fences and inline code. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/;

/**
 * One citation, `[4]` or `【4†L3】`. Up to two digits (a search returns at most 50 passages), so `[1974]` is
 * text. Lists are left alone: `[0, 1]` is as likely an interval.
 */
const ONE = /\[([1-9]\d?)\]|【([1-9]\d?)(?:†[^】]*)?】/g;

/**
 * Citations with nothing between them, and the space before: ` [1][4]`. Not attached to a word
 * (`items[4]`, `rows[2][9]`), nor a Markdown link (`[4](…)`).
 */
const RUN = new RegExp(String.raw`(\s*)(?<![\p{L}\p{N}_$](?:\[\d+\])*)((?:${ONE.source})+)(?![(\[【])`, 'gu');

/**
 * A model's reply without citations to passages it was not given (`ranks`). The number is removed, never
 * swapped for another: a wrong guess would look like evidence.
 */
export function dropUnknownCitations(text: string, ranks: number[]): string {
  const cleaned = text
    .split(CODE)
    .map((part, i) => (i % 2 ? part : clean(part, ranks)))
    .join('');
  // Nothing but citations: keep what the model wrote over an empty reply.
  return cleaned.trim() ? cleaned : text;
}

function clean(text: string, ranks: number[]): string {
  return text.replace(RUN, (_, space: string, run: string) => {
    const kept = [...run.matchAll(ONE)].filter((m) => ranks.includes(Number(m[1] ?? m[2])));
    return kept.length ? space + kept.map((m) => m[0]).join('') : '';
  });
}
