/**
 * Whether a model's reply is a refusal: it opens by saying the material does not cover the question,
 * and says little else. Some models cite the passages they were given even while refusing (seen with
 * the academic and talkative styles on Qwen 3.6, docs/tuning.md), which would otherwise make the refusal
 * count as grounded.
 *
 * English only, like the prompts that ask for this wording. A reply in another language is judged by its
 * citations alone, as before.
 */
export function isRefusal(text: string): boolean {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?;])\s+/)
    .filter((s) => s.length > 0);
  // A partial answer says what is missing and then answers the rest at length.
  if (sentences.length > MAX_SENTENCES) return false;
  // The refusal comes first, after at most a short opener with no citation, such as "Great question!".
  const [first = '', second = ''] = sentences;
  const isOpener = first.length <= SHORT_OPENER && !MARKER.test(first);
  const opening = (isOpener ? `${first} ${second}` : first).replace(MARKERS, '');
  return NOT_COVERED.some((pattern) => pattern.test(opening));
}

const MARKER = /\[\d+(?:\s*,\s*\d+)*\]|【[^】]*】/;
const MARKERS = new RegExp(MARKER.source, 'g');

/** A refusal may add a sentence on what the passages are about instead; more than this is an answer. */
const MAX_SENTENCES = 3;
const SHORT_OPENER = 30;

const SOURCE = String.raw`(?:material|passages?|documents?|sources?|context|workspace|text|information)`;
const NEGATED = String.raw`(?:does not|do not|doesn't|don't|did not|cannot|can't|contains? no|has no|have no|provides? no|includes? no)`;
const VERB = String.raw`(?:cover|contain|mention|address|discuss|include|provide|describe|explain|answer|say|information|details?|data)`;

const NOT_COVERED = [
  // "The material does not cover …", "the passages contain no information about …"
  new RegExp(String.raw`\b${SOURCE}\b[^.!?]{0,60}?\b${NEGATED}\b[^.!?]{0,30}?\b${VERB}`, 'i'),
  // "This is not covered by the material", "… isn't mentioned in the passages"
  new RegExp(String.raw`\b(?:not|isn't|aren't) (?:covered|mentioned|addressed|discussed|included)\b`, 'i'),
  // The API's own fixed reply, and models that phrase it the same way.
  /\b(?:couldn't|could not|can't|cannot) find (?:anything|any information|information)\b/i,
];
