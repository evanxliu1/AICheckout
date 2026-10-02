// Quote helpers for the catalog expansion: keep every quote taken from an issuer capture to at most 25 words
// (the limit for committed files) while keeping the words that carry the evidence, and check committed files
// for longer verbatim runs.
import { quotePattern, resolveQuote } from '../../apps/api/src/curation/v2/validate.ts';

export const MAX_QUOTE_WORDS = 25;

const words = (text) => text.trim().split(/\s+/).filter(Boolean);
export const wordCount = (text) => words(text).length;

/** Free text (not a quote) clipped to `max` words, marked with an ellipsis when cut. */
export function clipWords(text, max = MAX_QUOTE_WORDS) {
  if (typeof text !== 'string') return text;
  const list = words(text);
  return list.length <= max ? text.trim() : `${list.slice(0, max).join(' ')}…`;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const formatNumber = (n) => String(Number(n.toFixed(4)));

/** A rate in basis points as the capture would write it: 400 -> "4" in "4X", "4%", "4 points", or "four". */
const NUMBER_WORDS = 'zero one two three four five six seven eight nine ten eleven twelve'.split(' ');
export function rateRegex(bps) {
  const value = bps / 100;
  const n = escape(formatNumber(value));
  const word = Number.isInteger(value) && NUMBER_WORDS[value] ? `|\\b${NUMBER_WORDS[value]}\\b` : '';
  return new RegExp(`(?<![\\d.,$])${n}(?:\\.0+)?(?!\\d|[.,]\\d)${word}`, 'i');
}
/** The first rate-like number in research text ("5% cash back", "3X points"), as a pattern; null if none. */
export function rateRegexFromText(text) {
  const match = /(\d+(?:\.\d+)?)\s*(%|x\b|X\b|×| percent| points?| miles?)/.exec(text ?? '');
  return match ? rateRegex(Math.round(Number(match[1]) * 100)) : null;
}
/** Any rate-like token (used to keep an anchor whose rate differs from the draft value, with a flag). */
export const ANY_RATE = /(?<![\d.,$])\d+(?:\.\d+)?\s*(?:%|x\b|X\b|×|percent\b)/;
/** A dollar amount as written in a capture: 500000 cents -> "$5,000", "$5000" or "$5K". */
export function amountRegex(cents) {
  const dollars = cents / 100;
  const plain = formatNumber(dollars);
  const grouped = Number(plain).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const forms = [grouped, plain];
  if (dollars >= 1000 && dollars % 1000 === 0) forms.push(`${dollars / 1000}[kK]`);
  const alt = [...new Set(forms)].map((form) => (form.endsWith('[kK]') ? form : escape(form))).join('|');
  return new RegExp(`\\$\\s?(?:${alt})(?:\\.00)?(?!\\d|[.,]\\d)`);
}
/** Any dollar amount of $10 or more ("$1" in "per $1 spent" is not a cap). */
export const ANY_AMOUNT = /\$\s?(?:[1-9]\d|\d{1,3},\d)/;

const STOP = new Set(
  'with your from that this when each card cards purchases purchase eligible other select credit back cash points point miles earn plus only made through account rewards reward member members year first total base bonus category categories including excluding such will have been they their them than then also more into upon used using these those which where while what about after before under over'.split(
    ' ',
  ),
);
/** Content words of free text, at least four letters, as case-insensitive word-start patterns. */
export function keywordPatterns(text) {
  const found = (text ?? '').match(/[A-Za-z][A-Za-z'&.-]{3,}/g) ?? [];
  const unique = [...new Set(found.map((word) => word.replace(/[.'-]+$/, '').toLowerCase()))];
  return unique
    .filter((word) => word.length >= 4 && !STOP.has(word))
    .map((w) => new RegExp(`\\b${escape(w)}`, 'i'));
}

/**
 * The best window of at most `max` consecutive words of `quote` that matches every `required` pattern: windows are
 * as long as allowed (more context), ranked by how many `prefer` patterns they match, then by starting a sentence,
 * then by starting earliest. Returns null when no window carries every required pattern.
 */
export function bestWindow(quote, { required = [], prefer = [], max = MAX_QUOTE_WORDS } = {}) {
  const list = words(quote);
  if (!list.length) return null;
  const length = Math.min(max, list.length);
  let best = null;
  for (let start = 0; start + length <= list.length; start++) {
    const text = list.slice(start, start + length).join(' ');
    if (!required.every((pattern) => pattern.test(text))) continue;
    const hits = prefer.filter((pattern) => pattern.test(text)).length;
    const sentence = start === 0 || /[.!?:;]$/.test(list[start - 1]) ? 1 : 0;
    if (!best || hits > best.hits || (hits === best.hits && sentence > best.sentence))
      best = { text, hits, sentence };
  }
  return best?.text ?? null;
}

/**
 * An anchor of at most 25 words for `quote`, which must resolve in `input`'s documents (same matching as the
 * corpus: whitespace-insensitive, either quotation-mark form). A quote within the limit is kept as is. A longer
 * one becomes its best window carrying `spec.required`; failing that, a window carrying `spec.fallback.required`
 * (status `mismatch`, e.g. the quote states another amount than the draft); failing that, it is dropped.
 * Returns { status: 'kept' | 'shortened' | 'mismatch' | 'dropped' | 'unresolved', text? }.
 */
export function shortAnchor(quote, input, spec = {}) {
  const text = (quote ?? '').trim().replace(/\s+/g, ' ');
  if (!text || !resolveQuote(text, input)) return { status: 'unresolved' };
  if (wordCount(text) <= MAX_QUOTE_WORDS) return { status: 'kept', text };
  const tries = [
    ['shortened', spec.required ?? []],
    ...(spec.fallback ? [['mismatch', spec.fallback.required ?? []]] : []),
  ];
  for (const [status, required] of tries) {
    const window = bestWindow(text, { required, prefer: spec.prefer ?? [] });
    if (window && resolveQuote(window, input)) return { status, text: window };
  }
  return { status: 'dropped' };
}

/** True when `quote` resolves in `input` (re-exported so callers need one import). */
export const resolves = (quote, input) => Boolean(resolveQuote(quote, input));
export { quotePattern, resolveQuote };

// ---- Committed-file check --------------------------------------------------------------------------------
const QUOTE_FORMS = { '‘': "'", '’': "'", '“': '"', '”': '"' };
const normalWords = (text) =>
  text
    .toLowerCase()
    .replace(/[‘’“”]/g, (mark) => QUOTE_FORMS[mark])
    .split(/\s+/)
    .filter(Boolean);
const wordHash = (word) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 0x01000193);
  return h >>> 0;
};
const BASE = 0x9e3779b1;

/** Rolling hashes of every `size`-word run, from per-word hashes, modulo 2^32. */
function runHashes(hashes, size) {
  const out = [];
  if (hashes.length < size) return out;
  let top = 1;
  for (let i = 1; i < size; i++) top = Math.imul(top, BASE);
  let h = 0;
  for (let i = 0; i < size; i++) h = (Math.imul(h, BASE) + hashes[i]) >>> 0;
  out.push(h);
  for (let i = size; i < hashes.length; i++) {
    h = (h - Math.imul(hashes[i - size], top)) >>> 0;
    h = (Math.imul(h, BASE) + hashes[i]) >>> 0;
    out.push(h);
  }
  return out;
}

/**
 * Index of the captures for finding verbatim runs longer than `limit` words. Matching is case-insensitive,
 * treats any whitespace run as one space and either quotation-mark form as the same.
 */
export function captureIndex(bodies, limit = MAX_QUOTE_WORDS) {
  const size = limit + 1;
  const texts = [];
  const runs = new Set();
  for (const body of bodies) {
    const list = normalWords(body);
    texts.push(` ${list.join(' ')} `);
    for (const h of runHashes(list.map(wordHash), size)) runs.add(h);
  }
  return { size, runs, texts };
}

/** The first run of more than `limit` words of `text` that appears verbatim in a capture, or null. */
export function longCaptureRun(text, index) {
  const list = normalWords(text);
  const hashes = runHashes(list.map(wordHash), index.size);
  for (let i = 0; i < hashes.length; i++) {
    if (!index.runs.has(hashes[i])) continue;
    const run = ` ${list.slice(i, i + index.size).join(' ')} `;
    if (index.texts.some((body) => body.includes(run))) return run.trim();
  }
  return null;
}

/** Every string inside a JSON value, with its path. */
export function* stringsOf(value, path = '$') {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value))
    for (const [i, item] of value.entries()) yield* stringsOf(item, `${path}[${i}]`);
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) yield* stringsOf(item, `${path}.${key}`);
}

/**
 * Units of a markdown file to check one by one: each table cell and each other line (so a table row does not
 * join quotes from neighbouring cells into one run).
 */
export const markdownUnits = (text) =>
  text
    .split('\n')
    .flatMap((line, i) =>
      (line.trim().startsWith('|') ? line.split(/(?<!\\)\|/) : [line]).map((unit) => [`line ${i + 1}`, unit]),
    );
