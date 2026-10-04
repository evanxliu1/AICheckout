// Turn the expansion extractions into draft labels, product notes, and verification packets.
//
//   node scripts/draft-expansion-labels.mjs [--dir evals/curation/expansion]
//
// Reads cards.json, sources.json, manifest.json, captures/ and extractions/ (both gitignored), and the
// research drafts. Every quote it writes (anchors, issuer wordings, hint anchors) is a verbatim span of a capture
// of at most 25 words, so the outputs can be committed; free text from the research or the extraction (exclusion
// text, hint summaries and conditions, card notes) is clipped to 25 words. Writes:
//   corpus.draft.json   one base case per successfully extracted card, in the corpus v2 format,
//                       annotationStatus "agent-drafted". Only values whose evidence resolves in the captures
//                       are kept; anchors are the extraction's own resolving quotes, a quote over 25 words cut to
//                       its best 25-word window that still carries the value (the rate, the cap amount, ...).
//   product-notes.json  per card: structured hints the extraction schema cannot express (merchant rules,
//                       chosen or rotating categories, store-only cards, relationship tiers, checkout-method
//                       rules), each with an anchor that resolves in the captures or marked `unanchored` with
//                       its research source; plus notes on what the drafting dropped.
//   verify/<issuer>.md  what an independent verifier must check for each card.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import {
  ANY_AMOUNT,
  ANY_RATE,
  MAX_QUOTE_WORDS,
  amountRegex,
  captureIndex,
  captureSpans,
  clipWords,
  longCaptureRun,
  keywordPatterns,
  rateRegex,
  rateRegexFromText,
  shortAnchor,
} from './lib/expansion-quotes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { dir: { type: 'string', default: 'evals/curation/expansion' } } });
const dir = resolve(root, values.dir);
const relDir = values.dir.replace(/\/$/, '');

const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: `
      export { caseSchema, corpusV2Schema, checkCase } from './apps/api/src/curation/v2/corpus.ts';
      export { resolveQuote } from './apps/api/src/curation/v2/validate.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { caseSchema, corpusV2Schema, checkCase, resolveQuote } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const { cards } = await json(join(dir, 'cards.json'));
const manifest = await json(join(dir, 'manifest.json'));
const manifestById = new Map(manifest.sources.map((source) => [source.id, source]));
const summary = await json(join(dir, 'extraction-summary.json')).catch(() => ({ cards: [] }));
const summaryById = new Map(summary.cards.map((row) => [row.cardId, row]));

/** Research card by id (Discover entries win over the Capital One duplicates, as in build-expansion-cards). */
const research = new Map();
for (const card of cards)
  if (!research.has(card.id)) {
    const file = await json(join(root, card.research));
    research.set(
      card.id,
      file.cards.find((entry) => entry.id === card.id),
    );
  }

/** A card's captured documents (full captures, hash-checked), as resolveQuote expects. */
async function documentsFor(card) {
  const documents = [];
  for (const sourceId of card.sourceIds) {
    const source = manifestById.get(sourceId);
    if (!source) continue;
    const body = await readFile(join(dir, 'captures', `${sourceId}.txt`), 'utf8').catch(() => null);
    if (body === null || sha256(body) !== source.sha256) continue;
    documents.push({
      id: sourceId,
      title: source.title,
      url: source.url,
      capturedOn: source.capturedOn,
      body,
      contentHash: source.sha256,
    });
  }
  return documents;
}

/** Longest capture line or sentence considered when searching for a hint anchor (it is then cut to 25 words). */
const MAX_ANCHOR = 400;

/** Anchor outcomes by kind (rule, currency, exclusion, hint, issuerWording, ...) and status, for the run summary. */
const tally = {};
const count = (kind, status) => {
  tally[kind] ??= {};
  tally[kind][status] = (tally[kind][status] ?? 0) + 1;
};

/**
 * A resolving anchor of at most 25 words for `quote` (see shortAnchor), or null. `spec` names the tokens the
 * anchor must keep; a shortened anchor that keeps only a fallback token, or a dropped one, is noted for the verifier.
 */
function anchorFor(quote, input, spec = {}, kind = 'other', notes = null, label = '') {
  const result = shortAnchor(quote, input, spec);
  if (result.text) specsOf.set(result.text, [...(specsOf.get(result.text) ?? []), spec]);
  if (result.status !== 'unresolved') count(kind, result.status);
  if (notes && result.status === 'dropped')
    notes.push(
      `${label}: a quote over ${MAX_QUOTE_WORDS} words was dropped (no ${MAX_QUOTE_WORDS}-word window carries ${spec.what ?? 'the evidence'})`,
    );
  if (notes && result.status === 'mismatch')
    notes.push(
      `${label}: anchor kept, but no ${MAX_QUOTE_WORDS}-word window states ${spec.what}; check the value against its anchor`,
    );
  return result.text ?? null;
}
const anchorsFor = (quotes, input, spec, kind, notes, label, max = 4) => {
  const out = [];
  for (const quote of quotes) {
    const anchor = anchorFor(quote, input, spec, kind, notes, label);
    if (anchor && !out.includes(anchor)) out.push(anchor);
    if (out.length === max) break;
  }
  return out;
};

/** The specs each anchor text was cut for (what it must keep), for the current card. */
const specsOf = new Map();

/** True when `spans` (capture word spans) overlap or abut into a run of more than 25 words. */
function longRun(spans) {
  const sorted = [...spans].sort((a, b) => a.doc - b.doc || a.start - b.start);
  let run = null;
  for (const span of sorted) {
    if (run && run.doc === span.doc && span.start <= run.end) run.end = Math.max(run.end, span.end);
    else run = { ...span };
    if (run.end - run.start > MAX_QUOTE_WORDS) return true;
  }
  return false;
}

/** True when `piece` still carries what its original anchor carried for every spec it was cut for. */
function keepsEvidence(piece, original, specs) {
  const all = (patterns, text) => patterns.every((pattern) => pattern.test(text));
  return specs.every((spec) => {
    if (spec.required?.length && all(spec.required, original)) return all(spec.required, piece);
    if (spec.fallback?.required?.length && all(spec.fallback.required, original))
      return all(spec.fallback.required, piece);
    const prefer = spec.prefer ?? [];
    return !prefer.some((pattern) => pattern.test(original)) || prefer.some((pattern) => pattern.test(piece));
  });
}

/**
 * Anchors of one item read together must not form a run of more than 25 consecutive capture words (two cut
 * windows of one sentence, or consecutive sentences). Earlier anchors win; a later one that overlaps or abuts
 * them into a longer run is cut to its longest part clear of them (with a one-word gap) that still carries its
 * evidence, or dropped.
 */
function separateAnchors(texts, input, notes, label) {
  input.index ??= captureIndex(input.documents.map((document) => document.body));
  const kept = [];
  const spans = [];
  // Overlapping or abutting spans, or (for a quote whose first words happen to continue the one before) the
  // anchors joined as text.
  const runsOn = (text) =>
    longRun([...spans, ...captureSpans(text, input.index)]) ||
    Boolean(longCaptureRun([...kept, text].join(' '), input.index));
  for (const text of texts) {
    const own = captureSpans(text, input.index);
    if (!runsOn(text)) {
      kept.push(text);
      spans.push(...own);
      continue;
    }
    const words = text.split(' ');
    const blocked = new Set();
    for (const span of own)
      for (const other of spans)
        if (other.doc === span.doc)
          for (let i = 0; i < words.length; i++)
            if (span.start + i >= other.start - 1 && span.start + i <= other.end) blocked.add(i);
    const parts = [];
    let from = null;
    for (let i = 0; i <= words.length; i++) {
      if (i < words.length && !blocked.has(i)) from ??= i;
      else if (from !== null) {
        parts.push(words.slice(from, i).join(' '));
        from = null;
      }
    }
    for (let k = 1; k <= 3 && k < words.length; k++)
      parts.push(words.slice(k).join(' '), words.slice(0, -k).join(' '));
    const piece = parts
      .filter((part) => part.split(' ').length >= 3)
      .sort((a, b) => b.split(' ').length - a.split(' ').length)
      .find(
        (part) =>
          resolveQuote(part, input) && keepsEvidence(part, text, specsOf.get(text) ?? []) && !runsOn(part),
      );
    if (piece && !kept.includes(piece)) {
      count('adjacent', 'shortened');
      kept.push(piece);
      spans.push(...captureSpans(piece, input.index));
      notes.push(
        `${label}: an anchor that ran on from another was shortened (no ${MAX_QUOTE_WORDS}+ word run)`,
      );
    } else {
      count('adjacent', 'dropped');
      notes.push(
        `${label}: an anchor that ran on from another was dropped (no ${MAX_QUOTE_WORDS}+ word run)`,
      );
    }
  }
  return kept;
}

// ---- What an anchor must keep, per field -----------------------------------------------------------------
const anyOf = (patterns) =>
  patterns.length ? [new RegExp(patterns.map((p) => p.source).join('|'), 'i')] : [];
const PERIOD = /\b(year|annual|quarter|month|billing|statement|cycle)/i;
const NO_CAP =
  /\bunlimited\b|\bno (cap|caps|limit|limits|maximum|max)\b|\bnot capped\b|\bno annual cap\b|\bno earning cap\b|\bwithout (a )?(cap|limit)/i;
const ACTIVATE = /activat|enroll|regist|opt[- ]?in|sign[- ]?up|select|choose|choice|\bmember|\bmust\b/i;
const NO_ACTIVATE =
  /\bno (need|categories|activation|enrollment|sign[- ]?ups?)\b|\bautomatic|\b(don.t|do not|never) (need|have) to\b|\bno .{0,20}to (activate|enroll)|\bnot required\b/i;
const US = /\bU\.?\s?S\.?(?=[\s,;:)-]|$)|\bUS\b|United States|domestic/i;
const NON_US =
  /worldwide|outside (of )?the U|foreign|international|abroad|anywhere|wherever|everywhere|around the world|globally/i;
const LIMITED =
  /limited[- ]time|promot|\boffer\b|through|until|\bends?\b|expire|first year|first \d+|within \d+|account open|introductory|\b20\d\d\b|January|February|March|April|May|June|July|August|September|October|November|December/i;
const CURRENCY = {
  'cash-back': /cash\s?back|cash rewards|statement credit|\bcash\b|%/i,
  points: /\bpoints?\b|\bmiles?\b|rewards|\d\s*x\b/i,
};
const POINT_VALUE = /\$|\bcents?\b|¢|value|worth|redeem/i;

const rateSpec = (bps, prefer) =>
  bps === null
    ? { prefer }
    : {
        required: [rateRegex(bps)],
        prefer,
        fallback: { required: [ANY_RATE] },
        what: `the rate (${bps} bps)`,
      };
function capSpec(cap, prefer) {
  if (cap?.kind === 'spend' && cap.amountCents)
    return {
      required: [amountRegex(cap.amountCents)],
      prefer: [...prefer, PERIOD, ...(cap.rateAfterCapBps !== null ? [rateRegex(cap.rateAfterCapBps)] : [])],
      fallback: { required: [ANY_AMOUNT] },
      what: `the cap amount ($${(cap.amountCents / 100).toLocaleString('en-US')})`,
    };
  if (cap?.kind === 'none') return { required: [NO_CAP], prefer, what: 'that the rate is uncapped' };
  return { prefer };
}
const valueSpec = (pattern, prefer, what) => (pattern ? { required: [pattern], prefer, what } : { prefer });

/** Draft a reference from an extraction, keeping only values whose evidence resolves. */
function draftReference(extraction, input, notes) {
  specsOf.clear();
  const kept = (claim, label, spec = {}) => {
    if (claim.value === null) return { value: null, anchors: [] };
    const anchors = anchorsFor(claim.evidence, input, spec, 'value', notes, label);
    if (!anchors.length) {
      notes.push(`${label}: value dropped (no resolving quote)`);
      return { value: null, anchors: [] };
    }
    return { value: claim.value, anchors };
  };
  let rewardCurrency = kept(
    extraction.rewardCurrency,
    'rewardCurrency',
    valueSpec(
      CURRENCY[extraction.rewardCurrency.value],
      [],
      `the currency (${extraction.rewardCurrency.value})`,
    ),
  );
  if (rewardCurrency.value === null)
    notes.push('rewardCurrency: no anchored value; card left out of the corpus');
  const pointValue = kept(
    extraction.pointValueHundredthsOfCent,
    'pointValueHundredthsOfCent',
    valueSpec(POINT_VALUE, [], 'a cash value'),
  );
  const rules = [];
  extraction.rules.forEach((rule, i) => {
    const label = `rules.${i} (${rule.category}, "${rule.issuerWording.slice(0, 60)}")`;
    const prefer = keywordPatterns(`${rule.issuerWording} ${rule.category.replace(/-/g, ' ')}`);
    const rate = kept(rule.rateBps, `${label} rateBps`, rateSpec(rule.rateBps.value, prefer));
    const cap = kept(rule.cap, `${label} cap`, capSpec(rule.cap.value, prefer));
    const activation = kept(
      rule.activation,
      `${label} activation`,
      valueSpec(
        { none: NO_ACTIVATE, 'enroll-once': ACTIVATE, recurring: ACTIVATE }[rule.activation.value],
        prefer,
        `the activation (${rule.activation.value})`,
      ),
    );
    const usOnly = kept(
      rule.usMerchantsOnly,
      `${label} usMerchantsOnly`,
      valueSpec(
        rule.usMerchantsOnly.value === null ? null : rule.usMerchantsOnly.value ? US : NON_US,
        prefer,
        `the merchant location (${rule.usMerchantsOnly.value ? 'U.S. only' : 'not U.S. only'})`,
      ),
    );
    const limited = kept(
      rule.limitedTime,
      `${label} limitedTime`,
      valueSpec(LIMITED, prefer, 'a time limit'),
    );
    const paid =
      rule.paidOnPaymentBps.value === 0
        ? { value: 0, anchors: [] }
        : kept(
            rule.paidOnPaymentBps,
            `${label} paidOnPaymentBps`,
            rateSpec(rule.paidOnPaymentBps.value, prefer),
          );
    const anchors = [
      ...new Set([
        ...rate.anchors,
        ...cap.anchors,
        ...activation.anchors,
        ...usOnly.anchors,
        ...limited.anchors,
        ...paid.anchors,
      ]),
    ].slice(0, 4);
    if (!anchors.length) {
      notes.push(`${label}: rule dropped (no resolving quote)`);
      return;
    }
    let capValue = cap.value;
    if (capValue?.kind === 'spend' && capValue.amountCents === null) {
      notes.push(`${label}: spend cap without an amount set to null`);
      capValue = null;
    }
    if (capValue?.kind === 'none')
      capValue = { kind: 'none', amountCents: null, period: null, rateAfterCapBps: null };
    let paidValue = paid.value;
    if (paidValue !== null && rate.value !== null && paidValue > rate.value) paidValue = null;
    rules.push({
      category: rule.category,
      issuerWording: issuerWordingFor(rule, input, prefer, notes, label),
      rateBps: rate.value,
      paidOnPaymentBps: paidValue,
      cap: capValue,
      activation: activation.value,
      usMerchantsOnly: usOnly.value,
      limitedTime: limited.value,
      anchors,
    });
  });
  const exclusions = [];
  for (const exclusion of extraction.exclusions) {
    const label = `exclusion "${clipWords(exclusion.text, 8)}"`;
    const keywords = keywordPatterns(exclusion.text);
    const spec = { required: anyOf(keywords), prefer: keywords, what: 'a word of the exclusion' };
    const anchors = anchorsFor(
      [...exclusion.evidence, exclusion.text],
      input,
      spec,
      'exclusion',
      notes,
      label,
    );
    if (anchors.length) exclusions.push({ text: clipWords(exclusion.text).slice(0, 200), anchors });
    else notes.push(`${label}: dropped (no resolving quote)`);
  }
  const issues = [];
  for (const issue of extraction.issues) {
    const spec = { prefer: keywordPatterns(issue.detail) };
    const anchors = anchorsFor(issue.evidence, input, spec, 'issue', notes, `issue ${issue.code}`);
    if (issue.code !== 'missing' && !anchors.length) {
      notes.push(`issue ${issue.code}: dropped (no resolving quote)`);
      continue;
    }
    issues.push({ code: issue.code, anchors });
  }
  if (rewardCurrency.value === null || !rules.length) return null;
  for (const [item, label] of [
    [rewardCurrency, 'rewardCurrency'],
    [pointValue, 'pointValueHundredthsOfCent'],
    ...rules.map((rule, i) => [rule, `rules.${i} (${rule.category})`]),
    ...exclusions.map((exclusion, i) => [exclusion, `exclusions.${i}`]),
    ...issues.map((issue, i) => [issue, `issues.${i} (${issue.code})`]),
  ])
    item.anchors = separateAnchors(item.anchors, input, notes, label);
  return {
    rewardCurrency,
    pointValueHundredthsOfCent: pointValue,
    rules: rules.slice(0, 20),
    exclusions: exclusions.slice(0, 20),
    issues: issues.slice(0, 10),
  };
}

/**
 * The rule's issuer wording as a verbatim span of at most 25 words. A wording that resolves is kept, or cut to
 * its best window around the rate; one that does not resolve is not a quote and is clipped to 25 words, with a
 * note asking the verifier for the capture's wording.
 */
function issuerWordingFor(rule, input, prefer, notes, label) {
  const wording = rule.issuerWording.trim().replace(/\s+/g, ' ');
  if (!wording) {
    notes.push(`${label}: issuerWording is blank; add the capture's wording`);
    return rule.issuerWording;
  }
  const spec = { ...rateSpec(rule.rateBps.value, prefer), fallback: { required: [] } };
  const result = shortAnchor(wording, input, spec);
  if (result.status === 'unresolved') {
    count('issuerWording', 'not-verbatim');
    notes.push(
      `${label}: issuerWording is not verbatim in the captures; replace it with the capture's wording`,
    );
    return clipWords(wording);
  }
  count('issuerWording', result.status === 'mismatch' ? 'shortened' : result.status);
  return result.text;
}

// ---- Product notes ---------------------------------------------------------------------------------------
const HINT_TYPES = {
  'merchant-specific': 'merchant-specific',
  'cardholder-chosen-category': 'cardholder-chosen-category',
  'rotating-quarterly': 'rotating-quarterly',
  'top-category-automatic': 'automatic-top-category',
  'tiered-by-relationship': 'relationship-tier',
};
const STOP = new Set(
  'with your from that this when each card cards purchases purchase eligible other select credit back cash points point miles earn plus only made through account rewards reward member members year first total base bonus category categories including excluding'.split(
    ' ',
  ),
);

/** Quoted fragments in research text ("..." or '...'), split at ellipses, at least four words. */
function researchQuotes(text) {
  const out = [];
  for (const match of text.matchAll(/"([^"]{12,})"|“([^”]{12,})”|'([^']{12,})'(?=[\s,.;:)]|$)/g)) {
    const quote = match[1] ?? match[2] ?? match[3];
    for (const part of quote.split(/\s*(?:\.\.\.|…|\[\.\.\.\])\s*/))
      if (part.trim().split(/\s+/).length >= 4) out.push(part.trim());
  }
  return out;
}

/**
 * The capture sentence that best supports a hint: it must carry the rate (when one is given) and any `required`
 * pattern, and it ranks by how many distinct keywords it contains (at least two when two are available), then
 * by shortness.
 */
function searchAnchor(input, rateText, keywords, required = null) {
  const number = /(\d+(?:\.\d+)?)\s*(%|x\b|X\b| points?| miles?)/.exec(rateText ?? '');
  const ratePattern = number
    ? new RegExp(
        `(?<![\\d.])${number[1].replace('.', '\\.')}\\s*(%|x\\b|X\\b|percent| points?| miles?| ?back)`,
        'i',
      )
    : null;
  const words = [
    ...new Set(keywords.filter((word) => word.length >= 4 && !STOP.has(word.toLowerCase()))),
  ].map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
  if (!words.length) return null;
  const need = Math.min(2, words.length);
  let best = null;
  for (const document of input.documents)
    for (const line of document.body.split('\n'))
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        const text = sentence.trim();
        if (text.length < 20 || text.length > MAX_ANCHOR) continue;
        if ((ratePattern && !ratePattern.test(text)) || (required && !required.test(text))) continue;
        const hits = words.filter((word) => word.test(text)).length;
        if (hits < need) continue;
        if (!best || hits > best.hits || (hits === best.hits && text.length < best.text.length))
          best = { text, hits };
      }
  return best && resolveQuote(best.text, input) ? best.text : null;
}

/** The capture line (or sentence, if the line is long) around a resolving quote, so the anchor shows context; the caller cuts it to 25 words. */
function widen(quote, input) {
  const span = resolveQuote(quote, input);
  if (!span) return null;
  const body = input.documents.find((document) => document.id === span.documentId).body;
  const lineStart = body.lastIndexOf('\n', span.start - 1) + 1;
  const lineEnd = body.indexOf('\n', span.end);
  const line = body.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
  if (line.length <= MAX_ANCHOR && resolveQuote(line, input)) return line;
  const sentences = line.split(/(?<=[.!?])\s+/);
  const sentence = sentences.find((text) => resolveQuote(quote, { documents: [{ id: 'x', body: text }] }));
  if (sentence && sentence.trim().length <= MAX_ANCHOR && resolveQuote(sentence.trim(), input))
    return sentence.trim();
  return quote;
}

const keywordsOf = (text) => [
  ...new Set((text.match(/[A-Za-z][A-Za-z'&.-]{3,}/g) ?? []).map((w) => w.replace(/[.'-]+$/, ''))),
];

function productHints(card, input) {
  const card0 = research.get(card.id);
  const hints = [];
  // Closed-loop use is stated rarely and loosely; accept only an explicit "can only be used at/on" sentence.
  const STORE_ONLY = /\b(can|may) only be used\b|\bonly (be )?used (at|on|for)\b|\bonly accepted (at|on)\b/i;
  const add = (hint, quotes, keywords, rateText) => {
    const rate = rateRegexFromText(rateText);
    const prefer = keywordPatterns(keywords.join(' '));
    const spec = {
      required: [...(rate ? [rate] : []), ...(hint.type === 'closed-loop' ? [STORE_ONLY] : [])],
      prefer,
    };
    // A capture line chosen for the hint, cut to its best 25-word window that keeps the rate.
    const short = (line) => (line ? anchorFor(line, input, spec, 'hint') : null);
    let anchor = null,
      anchorMethod = null;
    for (const quote of quotes) {
      anchor = resolveQuote(quote, input) ? short(widen(quote, input)) || short(quote) : null;
      if (anchor) {
        anchorMethod = 'research-quote';
        break;
      }
    }
    if (!anchor && input.documents.length) {
      anchor = short(
        searchAnchor(input, rateText, keywords, hint.type === 'closed-loop' ? STORE_ONLY : null),
      );
      if (anchor) anchorMethod = 'keyword-search';
    }
    hints.push(
      anchor
        ? { ...hint, status: 'anchored', anchorMethod, anchor }
        : {
            ...hint,
            status: 'unanchored',
            research: card.research,
            researchSources: (card0?.sources ?? []).map((source) => source.url).slice(0, 4),
          },
    );
  };
  for (const rule of card0?.rewardsSummary ?? []) {
    const all = `${rule.category} ${rule.conditions ?? ''} ${rule.cap ?? ''}`;
    const type =
      HINT_TYPES[rule.ruleType] ?? (/\b(paypal|venmo)\b/i.test(rule.category) ? 'checkout-method' : null);
    if (!type) continue;
    const membership = /\b(member|membership|prime|costco|sam's|bj's|enroll|relationship|checking)\b/i.test(
      rule.conditions ?? '',
    )
      ? clipWords(rule.conditions ?? '')
      : null;
    const hint = {
      type,
      summary: clipWords(rule.category),
      rate: clipWords(rule.rate),
      cap: clipWords(rule.cap ?? null) ?? null,
      conditions: clipWords(rule.conditions ?? '') || null,
      ...(type === 'merchant-specific'
        ? { merchants: card.coBrandPartner ? [card.coBrandPartner] : [], membership }
        : {}),
      ...(type === 'relationship-tier' ? { membership } : {}),
      ...(type === 'rotating-quarterly' || type === 'cardholder-chosen-category'
        ? { activation: /activat|enroll|choose|select/i.test(all) ? 'required (see conditions)' : null }
        : {}),
    };
    const keywords = [
      ...keywordsOf(rule.category),
      ...(card.coBrandPartner ? keywordsOf(card.coBrandPartner) : []),
      ...(type === 'checkout-method' ? ['PayPal', 'Venmo'] : []),
    ];
    add(hint, researchQuotes(all), keywords, rule.rate);
  }
  if (card.closedLoop)
    add(
      {
        type: 'closed-loop',
        summary: `Store card: usable only with ${card.coBrandPartner ?? 'the partner'} (research flag).`,
        merchants: card.coBrandPartner ? [card.coBrandPartner] : [],
      },
      [],
      keywordsOf(card.coBrandPartner ?? ''),
      null,
    );
  return hints;
}

// ---- Build -----------------------------------------------------------------------------------------------
const cases = [];
const productNotes = [];
const status = new Map();
for (const card of cards) {
  const input = { documents: await documentsFor(card) };
  const notes = [];
  const saved = await json(join(dir, 'extractions', `${card.id}.json`)).catch(() => null);
  let reference = null;
  if (!saved) notes.push('No extraction.');
  else if (
    !saved.documents.every(
      (document) => manifestById.get(document.id)?.sha256 === (document.sourceSha256 ?? document.contentHash),
    )
  )
    notes.push('Extraction read pages that were re-captured since: re-run the extraction.');
  else if (!saved.trace.extraction)
    notes.push(`Extraction status ${saved.trace.status}: no output to draft from.`);
  else {
    reference = draftReference(saved.trace.extraction, input, notes);
    if (!reference) notes.push('No anchored rules or currency: not drafted.');
  }
  if (reference) {
    const item = caseSchema.parse({
      id: card.id,
      cardId: card.id,
      cardName: card.name.slice(0, 120),
      issuer: card.issuer,
      split: 'dev',
      sourceIds: saved.documents.map((document) => document.id),
      reference,
    });
    // Anchors must resolve in the documents the case lists.
    const caseInput = {
      cardId: card.id,
      cardName: item.cardName,
      documents: input.documents.filter((document) => item.sourceIds.includes(document.id)),
    };
    try {
      checkCase(item, caseInput);
      cases.push(item);
    } catch (error) {
      notes.push(`Draft failed the corpus check: ${error instanceof Error ? error.message : error}`);
      reference = null;
    }
  }
  status.set(card.id, { drafted: Boolean(reference), extraction: saved?.trace.status ?? 'not-run' });
  productNotes.push({
    cardId: card.id,
    issuer: card.issuer,
    hints: productHints(card, input),
    draftNotes: notes,
  });
}

// The extraction configuration as extract-cards.mjs recorded it in the summary.
const extractedWith = summary.configuration
  ? ['provider', 'model'].map((key) => summary.configuration[key]).join(' ') +
    `, effort ${summary.configuration.effort}, ${summary.configuration.prompt}, ${summary.configuration.selection}`
  : 'configuration not recorded';
const corpus = corpusV2Schema.parse({
  schemaVersion: 2,
  version: 'expansion.draft.1',
  origin: 'real-issuer-captures',
  annotationStatus: 'agent-drafted',
  description: `Catalog expansion: agent-drafted base labels converted from LLM extractions (${extractedWith}) of captured issuer pages. Only values whose quotes resolve in the captures are kept; every anchor is a verbatim span of at most 25 words. Not verified; split is a placeholder. Generated by scripts/draft-expansion-labels.mjs.`,
  cases,
});
await writeFile(join(dir, 'corpus.draft.json'), JSON.stringify(corpus, null, 2) + '\n');
await writeFile(
  join(dir, 'product-notes.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedBy: 'scripts/draft-expansion-labels.mjs',
      description:
        'Structured hints the extraction schema cannot express, from the research drafts (summaries and conditions clipped to 25 words). An anchored hint cites a quote of at most 25 words that resolves in the captures (research-quote: the research quoted it; keyword-search: a capture sentence with the rate and a keyword, which a verifier must confirm says what the hint says). Unanchored hints cite the research. draftNotes record what drafting dropped.',
      cards: productNotes,
    },
    null,
    2,
  ) + '\n',
);

// ---- Verification packets --------------------------------------------------------------------------------
const casesById = new Map(cases.map((item) => [item.cardId, item]));
const notesById = new Map(productNotes.map((entry) => [entry.cardId, entry]));
const slug = (issuer) =>
  issuer
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const fmt = (value) =>
  value === null || value === undefined
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
const capText = (cap) =>
  cap === null
    ? '—'
    : cap.kind === 'none'
      ? 'none'
      : `$${(cap.amountCents / 100).toLocaleString('en-US')} / ${cap.period ?? '?'}, then ${fmt(cap.rateAfterCapBps)} bps`;
await mkdir(join(dir, 'verify'), { recursive: true });
const issuers = [...new Set(cards.map((card) => card.issuer))];
for (const issuer of issuers) {
  const list = cards.filter((card) => card.issuer === issuer);
  const lines = [
    `# Verification packet: ${issuer}`,
    '',
    `${list.length} cards. Generated by \`scripts/draft-expansion-labels.mjs\`; the draft labels are in \`${relDir}/corpus.draft.json\` (case id = card id) and the hints in \`${relDir}/product-notes.json\`. Captures are local only (\`${relDir}/captures/\`, gitignored); check every value against them, not against the research or memory.`,
    '',
    '## What to check for every card',
    '',
    '1. **Card**: the captures are for this exact product (not a sibling card, a business version, or a comparison table). Note if the page says the card is closed to new applicants.',
    '2. **rewardCurrency / pointValueHundredthsOfCent**: cash back vs points/miles (miles count as points); point value only if a capture states a cash redemption value (1 cent = 100).',
    '3. **Each rule**: category mapping, issuerWording verbatim, `rateBps` is the total rate (not an increment; 5X points = 500 only if the capture ties a point to 1 cent, otherwise still the per-dollar multiple × 100), `paidOnPaymentBps`, cap (amount, period, after-cap rate), activation (null unless a sentence says none/enroll/recurring), `usMerchantsOnly` (null unless stated), `limitedTime` (promotions, first-year offers, end dates). Every anchor must state what the field says.',
    '4. **Missing rules**: read the captures for earning rules the draft lacks (base rate, merchant/partner rules, portal rules, first-year bonus categories, quarterly categories). Welcome bonuses, APRs, fees, and non-earning benefits are out of scope.',
    '5. **Wrong categories**: e.g. warehouse clubs vs supermarkets, online grocery vs supermarkets, partner purchases mapped to `other`.',
    '6. **Exclusions and issues**: exclusions are transactions that never earn; issues should flag real ambiguity/conflicts (e.g. product page and terms disagree).',
    '7. **Product notes**: each hint (merchant-specific rules with merchant names and membership requirements, chosen-category options and caps, rotating quarters with dates and activation, store-only use, relationship tiers, checkout-method rules) is true per the captures; `keyword-search` anchors were chosen automatically and must actually support the hint; `unanchored` hints need a capture quote or should be dropped.',
    '8. **Draft notes**: values the drafting dropped (no resolving quote) may be real: re-check them.',
    '',
    `Record findings in \`${relDir}/verification/<issuer-slug>.json\` in the format of \`evals/curation/expansion/verification/README.md\` (card verdict; each fix with field path, current value, corrected value and an anchor quote of at most ${MAX_QUOTE_WORDS} words, verbatim from a named capture). Quote nothing longer.`,
    '',
  ];
  for (const card of list) {
    const item = casesById.get(card.id);
    const entry = notesById.get(card.id);
    const run = summaryById.get(card.id);
    const meta = [
      card.group,
      card.coBrandPartner ? `co-brand: ${card.coBrandPartner}` : null,
      card.closedLoop ? 'store-only (closed loop)' : null,
      card.annualFeeUsd !== null ? `annual fee $${card.annualFeeUsd}` : `annual fee: ${card.annualFeeNote}`,
      `research currency: ${card.rewardCurrency}`,
    ]
      .filter(Boolean)
      .join('; ');
    lines.push(`## ${card.name} (\`${card.id}\`)`, '', meta, '');
    lines.push('Captures:');
    for (const sourceId of card.sourceIds) {
      const source = manifestById.get(sourceId);
      lines.push(
        source
          ? `- \`${relDir}/captures/${sourceId}.txt\` (${source.kind}, ${source.length} chars, ${source.capturedOn}): ${source.url}`
          : `- \`${sourceId}\`: **not captured** (see capture-report.md)`,
      );
    }
    for (const note of card.notes ?? []) lines.push(`- Note: ${clipWords(note)}`);
    lines.push('');
    lines.push(
      `Extraction: ${run?.status ?? 'not run'}${run?.inputNotes?.length ? ` (input: ${run.inputNotes.join('; ')})` : ''}. Draft: ${item ? `${item.reference.rules.length} rules` : '**none**'}.`,
      '',
    );
    if (item) {
      const ref = item.reference;
      lines.push(
        `Currency: ${fmt(ref.rewardCurrency.value)}; point value: ${fmt(ref.pointValueHundredthsOfCent.value)}.`,
        '',
        '| # | category | issuer wording | rate bps | paid on payment | cap | activation | U.S. only | limited time |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      );
      ref.rules.forEach((rule, i) =>
        lines.push(
          `| ${i} | ${rule.category} | ${rule.issuerWording.replace(/\|/g, '/')} | ${fmt(rule.rateBps)} | ${fmt(rule.paidOnPaymentBps)} | ${capText(rule.cap)} | ${fmt(rule.activation)} | ${fmt(rule.usMerchantsOnly)} | ${fmt(rule.limitedTime)} |`,
        ),
      );
      lines.push(
        '',
        `Exclusions: ${ref.exclusions.length}; issues: ${ref.issues.map((issue) => issue.code).join(', ') || 'none'}.`,
        '',
      );
    }
    if (entry?.hints.length) {
      lines.push('Product notes:');
      for (const hint of entry.hints)
        lines.push(
          `- ${hint.type} (${hint.status}${hint.anchorMethod ? `, ${hint.anchorMethod}` : ''}): ${hint.summary.replace(/\n/g, ' ')}${hint.rate ? ` — ${hint.rate}` : ''}`,
        );
      lines.push('');
    }
    if (entry?.draftNotes.length) {
      lines.push('Draft notes:');
      for (const note of entry.draftNotes) lines.push(`- ${note}`);
      lines.push('');
    }
  }
  await writeFile(join(dir, 'verify', `${slug(issuer)}.md`), lines.join('\n'));
}

const hintCounts = {};
for (const entry of productNotes)
  for (const hint of entry.hints) {
    const key = `${hint.type}/${hint.status}`;
    hintCounts[key] = (hintCounts[key] ?? 0) + 1;
  }
console.log(`corpus.draft.json: ${cases.length} cases of ${cards.length} cards`);
console.log('product notes:', hintCounts);
console.log('anchors (kept = within 25 words, shortened, mismatch = kept a fallback token, dropped):', tally);
