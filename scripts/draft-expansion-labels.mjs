// Turn the expansion extractions into draft labels, product notes, and verification packets.
//
//   node scripts/draft-expansion-labels.mjs [--dir evals/curation/expansion]
//
// Reads cards.json, sources.json, manifest.json, captures/ and extractions/ (both gitignored), and the
// research drafts. Writes (committed, no captured text beyond short anchor quotes):
//   corpus.draft.json   one base case per successfully extracted card, in the corpus v2 format,
//                       annotationStatus "agent-drafted". Only values whose evidence resolves in the captures
//                       are kept; anchors are the extraction's own resolving quotes, each <= 400 characters.
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

const MAX_ANCHOR = 400;
/** A resolving anchor of at most 400 characters: the quote itself, or its longest resolving word-boundary prefix. */
function anchorFor(quote, input) {
  const text = quote.trim().replace(/\s+/g, ' ');
  if (!text || !resolveQuote(text, input)) return null;
  if (text.length <= MAX_ANCHOR) return text;
  const cut = text.slice(0, MAX_ANCHOR);
  const prefix = cut.slice(0, cut.lastIndexOf(' ')).trim();
  return prefix && resolveQuote(prefix, input) ? prefix : null;
}
const anchorsFor = (quotes, input, max = 4) => {
  const out = [];
  for (const quote of quotes) {
    const anchor = anchorFor(quote, input);
    if (anchor && !out.includes(anchor)) out.push(anchor);
    if (out.length === max) break;
  }
  return out;
};

/** Draft a reference from an extraction, keeping only values whose evidence resolves. */
function draftReference(extraction, input, notes) {
  const kept = (claim, label) => {
    if (claim.value === null) return { value: null, anchors: [] };
    const anchors = anchorsFor(claim.evidence, input);
    if (!anchors.length) {
      notes.push(`${label}: value dropped (no resolving quote)`);
      return { value: null, anchors: [] };
    }
    return { value: claim.value, anchors };
  };
  let rewardCurrency = kept(extraction.rewardCurrency, 'rewardCurrency');
  if (rewardCurrency.value === null)
    notes.push('rewardCurrency: no anchored value; card left out of the corpus');
  const pointValue = kept(extraction.pointValueHundredthsOfCent, 'pointValueHundredthsOfCent');
  const rules = [];
  extraction.rules.forEach((rule, i) => {
    const label = `rules.${i} (${rule.category}, "${rule.issuerWording.slice(0, 60)}")`;
    const rate = kept(rule.rateBps, `${label} rateBps`);
    const cap = kept(rule.cap, `${label} cap`);
    const activation = kept(rule.activation, `${label} activation`);
    const usOnly = kept(rule.usMerchantsOnly, `${label} usMerchantsOnly`);
    const limited = kept(rule.limitedTime, `${label} limitedTime`);
    const paid =
      rule.paidOnPaymentBps.value === 0
        ? { value: 0, anchors: [] }
        : kept(rule.paidOnPaymentBps, `${label} paidOnPaymentBps`);
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
      issuerWording: rule.issuerWording,
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
    const anchors = anchorsFor([...exclusion.evidence, exclusion.text], input);
    if (anchors.length) exclusions.push({ text: exclusion.text.slice(0, 200), anchors });
    else notes.push(`exclusion "${exclusion.text.slice(0, 60)}": dropped (no resolving quote)`);
  }
  const issues = [];
  for (const issue of extraction.issues) {
    const anchors = anchorsFor(issue.evidence, input);
    if (issue.code !== 'missing' && !anchors.length) {
      notes.push(`issue ${issue.code}: dropped (no resolving quote)`);
      continue;
    }
    issues.push({ code: issue.code, anchors });
  }
  if (rewardCurrency.value === null || !rules.length) return null;
  return {
    rewardCurrency,
    pointValueHundredthsOfCent: pointValue,
    rules: rules.slice(0, 20),
    exclusions: exclusions.slice(0, 20),
    issues: issues.slice(0, 10),
  };
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

/** Sentences of the captures that carry the rate and one of the keywords. */
function searchAnchor(input, rateText, keywords) {
  const number = /(\d+(?:\.\d+)?)\s*(%|x\b|X\b| points?| miles?)/.exec(rateText ?? '');
  const ratePattern = number
    ? new RegExp(
        `(?<![\\d.])${number[1].replace('.', '\\.')}\\s*(%|x\\b|X\\b|percent| points?| miles?| ?back)`,
        'i',
      )
    : null;
  const words = keywords.filter((word) => word.length >= 4 && !STOP.has(word.toLowerCase()));
  if (!words.length) return null;
  const wordPattern = new RegExp(
    `\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'i',
  );
  let best = null;
  for (const document of input.documents)
    for (const line of document.body.split('\n'))
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        const text = sentence.trim();
        if (text.length < 20 || text.length > MAX_ANCHOR) continue;
        if ((ratePattern && !ratePattern.test(text)) || !wordPattern.test(text)) continue;
        if (!best || text.length < best.length) best = text;
      }
  return best && resolveQuote(best, input) ? best : null;
}

const keywordsOf = (text) => [
  ...new Set((text.match(/[A-Za-z][A-Za-z'&.-]{3,}/g) ?? []).map((w) => w.replace(/[.'-]+$/, ''))),
];

function productHints(card, input) {
  const card0 = research.get(card.id);
  const hints = [];
  const add = (hint, quotes, keywords, rateText) => {
    let anchor = null,
      anchorMethod = null;
    for (const quote of quotes) {
      anchor = anchorFor(quote, input);
      if (anchor) {
        anchorMethod = 'research-quote';
        break;
      }
    }
    if (!anchor && input.documents.length) {
      anchor = searchAnchor(input, rateText, keywords);
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
    const type = HINT_TYPES[rule.ruleType] ?? (/\b(paypal|venmo)\b/i.test(all) ? 'checkout-method' : null);
    if (!type) continue;
    const membership = /\b(member|membership|prime|costco|sam's|bj's|enroll|relationship|checking)\b/i.test(
      rule.conditions ?? '',
    )
      ? (rule.conditions ?? '').slice(0, 300)
      : null;
    const hint = {
      type,
      summary: rule.category.slice(0, 300),
      rate: rule.rate,
      cap: rule.cap ?? null,
      conditions: (rule.conditions ?? '').slice(0, 300) || null,
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
      [...keywordsOf(card.coBrandPartner ?? ''), 'only'],
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

const corpus = corpusV2Schema.parse({
  schemaVersion: 2,
  version: 'expansion.draft.1',
  origin: 'real-issuer-captures',
  annotationStatus: 'agent-drafted',
  description:
    'Catalog expansion: agent-drafted base labels converted from LLM extractions (codex gpt-5.5, effort low, guided.2, keyword-window.1) of captured issuer pages. Only values whose quotes resolve in the captures are kept. Not verified; split is a placeholder. Generated by scripts/draft-expansion-labels.mjs.',
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
        'Structured hints the extraction schema cannot express, from the research drafts. An anchored hint cites a quote that resolves in the captures (research-quote: the research quoted it; keyword-search: a capture sentence with the rate and a keyword, which a verifier must confirm says what the hint says). Unanchored hints cite the research. draftNotes record what drafting dropped.',
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
    'Record fixes as: card id, field path, current value, corrected value, anchor quote (≤ 400 characters, verbatim from a capture).',
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
    for (const note of card.notes ?? []) lines.push(`- Note: ${note}`);
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
