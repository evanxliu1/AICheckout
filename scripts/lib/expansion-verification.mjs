// Verification findings for the catalog expansion: the format per-issuer verifier agents write
// (`verification/<issuer-slug>.json`, documented in evals/curation/expansion/verification/README.md), its
// validation, and how accepted fixes turn the agent-drafted labels into the agent-verified corpus.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  caseSchema,
  checkCase,
  corpusV2Schema,
  referenceRuleSchema,
  referenceSchema,
} from '../../apps/api/src/curation/v2/corpus.ts';
import { resolveQuote } from '../../apps/api/src/curation/v2/validate.ts';
import { MAX_QUOTE_WORDS, clipWords, wordCount } from './expansion-quotes.mjs';

// ---- Format ----------------------------------------------------------------------------------------------
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
const text = z.string().trim().min(1).max(1000);
export const quoteSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => wordCount(value) <= MAX_QUOTE_WORDS, `a quote is at most ${MAX_QUOTE_WORDS} words`);
/** A verbatim quote of at most 25 words and the capture it comes from. */
export const anchorRefSchema = z.strictObject({ sourceId: id, quote: quoteSchema });

/** Second-pass decision on one finding. `modified` carries the adjudicator's own value (and anchor). */
export const adjudicationSchema = z.strictObject({
  decision: z.enum(['accepted', 'rejected', 'modified']),
  reason: text,
  corrected: z.json().optional(),
  anchor: anchorRefSchema.optional(),
  replacement: z.record(z.string(), z.json()).optional(),
});

/** `reference.<field>[.<index or field>]...`, e.g. `reference.rules.1.cap.amountCents`. */
const pathSchema = z
  .string()
  .regex(/^reference(\.[A-Za-z]+|\.\d+)+$/, 'a path like reference.rules.1.rateBps');

export const fixSchema = z
  .strictObject({
    op: z.enum(['set', 'remove']).default('set'),
    path: pathSchema,
    current: z.json(),
    corrected: z.json().optional(),
    anchor: anchorRefSchema.optional(),
    note: text,
    adjudication: adjudicationSchema.optional(),
  })
  .superRefine((fix, ctx) => {
    const issue = (message) => ctx.addIssue({ code: 'custom', message });
    if (fix.op === 'set' && fix.corrected === undefined) issue('a set fix needs `corrected`');
    if (fix.op === 'set' && !fix.anchor) issue('a set fix needs an anchor');
    if (fix.op === 'remove' && fix.corrected !== undefined) issue('a remove fix has no `corrected`');
    if (fix.op === 'remove' && !/\.\d+$/.test(fix.path)) issue('a remove fix names an array element');
    if (
      fix.adjudication?.decision === 'modified' &&
      (fix.op === 'remove' || fix.adjudication.corrected === undefined)
    )
      issue('a modified adjudication of a set fix gives `corrected`');
    if (fix.adjudication?.replacement) issue('a fix adjudication has no `replacement`');
  });

const addition = (shape) => {
  const item = z.strictObject(shape);
  return {
    item,
    schema: z
      .strictObject({ ...shape, note: text, adjudication: adjudicationSchema.optional() })
      .superRefine((value, ctx) => {
        if (value.adjudication?.decision === 'modified' && !value.adjudication.replacement)
          ctx.addIssue({
            code: 'custom',
            message: 'a modified adjudication of an addition gives `replacement`',
          });
      }),
  };
};
const anchorRefs = z.array(anchorRefSchema).min(1).max(4);
const ADDED = {
  addedRules: addition({ rule: referenceRuleSchema.omit({ anchors: true }), anchors: anchorRefs }),
  addedExclusions: addition({ text: quoteSchema.pipe(z.string().max(200)), anchors: anchorRefs }),
  addedIssues: addition({
    code: referenceSchema.shape.issues.element.shape.code,
    anchors: z.array(anchorRefSchema).max(4),
  }),
};

export const HINT_TYPES = [
  'merchant-specific',
  'cardholder-chosen-category',
  'rotating-quarterly',
  'automatic-top-category',
  'relationship-tier',
  'checkout-method',
  'closed-loop',
];
const hintSchema = z.looseObject({
  type: z.enum(HINT_TYPES),
  summary: quoteSchema.pipe(z.string().max(300)),
});
export const productNoteChangeSchema = z
  .strictObject({
    action: z.enum(['confirm', 'fix', 'drop', 'add']),
    hintIndex: z.number().int().min(0).optional(),
    hint: hintSchema.optional(),
    anchor: anchorRefSchema.optional(),
    note: text,
    adjudication: adjudicationSchema.optional(),
  })
  .superRefine((change, ctx) => {
    const issue = (message) => ctx.addIssue({ code: 'custom', message });
    if (change.action !== 'add' && change.hintIndex === undefined) issue(`${change.action} needs hintIndex`);
    if (['fix', 'add'].includes(change.action) && !change.hint) issue(`${change.action} needs hint`);
    if (change.action !== 'drop' && !change.anchor) issue(`${change.action} needs an anchor`);
  });

export const cardVerificationSchema = z
  .strictObject({
    cardId: id,
    verdict: z.enum(['confirmed', 'fixed', 'drop-card']),
    /** Required for drop-card (wrong product, closed to new applicants, no earning rules, ...). */
    reason: text.nullable().default(null),
    fixes: z.array(fixSchema).default([]),
    addedRules: z.array(ADDED.addedRules.schema).default([]),
    addedExclusions: z.array(ADDED.addedExclusions.schema).default([]),
    addedIssues: z.array(ADDED.addedIssues.schema).default([]),
    productNoteChanges: z.array(productNoteChangeSchema).default([]),
    /** Second-pass decision on a drop-card verdict. */
    verdictAdjudication: z
      .strictObject({ decision: z.enum(['accepted', 'rejected']), reason: text })
      .optional(),
  })
  .superRefine((card, ctx) => {
    const issue = (message) => ctx.addIssue({ code: 'custom', message });
    const labelChanges =
      card.fixes.length + card.addedRules.length + card.addedExclusions.length + card.addedIssues.length;
    if (card.verdict === 'drop-card' && !card.reason) issue('drop-card needs a reason');
    if (card.verdict === 'confirmed' && labelChanges) issue('a confirmed card has no fixes or additions');
    if (card.verdict === 'fixed' && !labelChanges) issue('a fixed card has at least one fix or addition');
    if (card.verdict !== 'drop-card' && card.verdictAdjudication)
      issue('only drop-card has verdictAdjudication');
  });

const agentSchema = z.strictObject({
  agent: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  date: z.iso.date(),
  filesRead: z.array(z.string().min(1).max(300)).max(400),
});
export const verificationFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  issuer: z.string().min(1).max(80),
  verifier: agentSchema.extend({ filesRead: agentSchema.shape.filesRead.min(1) }),
  /** The second pass; null until an adjudicator has decided every finding in the file. */
  adjudicator: agentSchema.nullable().default(null),
  cards: z.array(cardVerificationSchema).min(1).max(60),
});

// ---- Loading ---------------------------------------------------------------------------------------------
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

/**
 * Everything the apply step reads from an expansion directory: cards, manifest, draft corpus, product notes,
 * verification files, and the hash-checked captures (a missing or changed capture is left out).
 */
export async function loadExpansion(dir) {
  const { cards } = await readJson(join(dir, 'cards.json'));
  const manifest = await readJson(join(dir, 'manifest.json'));
  const draft = await readJson(join(dir, 'corpus.draft.json'));
  const productNotes = await readJson(join(dir, 'product-notes.json'));
  const names = (await readdir(join(dir, 'verification')).catch(() => [])).filter((n) => n.endsWith('.json'));
  const files = [];
  for (const name of names.sort())
    files.push({ name, data: await readJson(join(dir, 'verification', name)) });
  const captures = new Map();
  for (const source of manifest.sources) {
    const body = await readFile(join(dir, 'captures', `${source.id}.txt`), 'utf8').catch(() => null);
    if (body !== null && sha256(body) === source.sha256) captures.set(source.id, body);
  }
  return { cards, manifest, draft, productNotes, files, captures };
}

// ---- Applying --------------------------------------------------------------------------------------------
const parsePath = (path) => path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));
function locate(root, path) {
  const parts = parsePath(path);
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    parent = parent?.[part];
    if (parent === null || typeof parent !== 'object') return null;
  }
  const key = parts.at(-1);
  const exists = Array.isArray(parent)
    ? Number.isInteger(key) && key < parent.length
    : Object.hasOwn(parent, key);
  return exists ? { parent, key } : null;
}
/** The labelled item whose anchors support a value at `path`, or null for a path inside anchors. */
function anchorOwner(reference, path) {
  const parts = parsePath(path).slice(1);
  if (parts.includes('anchors')) return null;
  if (['rewardCurrency', 'pointValueHundredthsOfCent'].includes(parts[0])) return reference[parts[0]];
  if (['rules', 'exclusions', 'issues'].includes(parts[0]) && Number.isInteger(parts[1]))
    return reference[parts[0]][parts[1]] ?? null;
  return null;
}
const isAnchorPath = (path) => /\.anchors\.\d+$/.test(path) || /\.issuerWording$/.test(path);
const generalPath = (path) => path.replace(/^reference\./, '').replace(/\.\d+/g, '.*');
const emptyReference = () => ({
  rewardCurrency: { value: null, anchors: [] },
  pointValueHundredthsOfCent: { value: null, anchors: [] },
  rules: [],
  exclusions: [],
  issues: [],
});

/** Every finding of a card that needs a second-pass decision. */
const findingsOf = (entry) => [
  ...entry.fixes,
  ...entry.addedRules,
  ...entry.addedExclusions,
  ...entry.addedIssues,
  ...entry.productNoteChanges,
];
const applies = (finding) => ['accepted', 'modified'].includes(finding.adjudication?.decision);

/**
 * Validate the verification files and apply their adjudicated findings. Pure: returns the verified cases,
 * verified product notes, per-card statuses and every error; the caller writes nothing if `errors` is non-empty.
 *
 * A card enters the corpus only when its issuer file has an adjudicator, every finding on it has an
 * adjudication, and its verdict is not an accepted drop-card. A card with no verification entry is never
 * included.
 */
export function applyVerification({ cards, draft, productNotes, files, captures }) {
  const errors = [];
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const draftById = new Map(draft.cases.map((item) => [item.cardId, item]));
  const notesById = new Map(productNotes.cards.map((entry) => [entry.cardId, entry]));
  const entries = new Map(); // cardId -> { file, entry }
  const parsedFiles = [];

  for (const file of files) {
    const parsed = verificationFileSchema.safeParse(file.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push(`${file.name}: ${issue.path.join('.') || '(file)'}: ${issue.message}`);
      continue;
    }
    parsedFiles.push({ name: file.name, data: parsed.data });
    for (const entry of parsed.data.cards) {
      const card = cardById.get(entry.cardId);
      if (!card) errors.push(`${file.name}: ${entry.cardId}: not in cards.json`);
      else if (card.issuer !== parsed.data.issuer)
        errors.push(`${file.name}: ${entry.cardId}: issuer is ${card.issuer}, not ${parsed.data.issuer}`);
      else if (entries.has(entry.cardId))
        errors.push(`${file.name}: ${entry.cardId}: also verified in ${entries.get(entry.cardId).file.name}`);
      else entries.set(entry.cardId, { file: parsed.data, name: file.name, entry });
    }
  }

  const statuses = new Map(cards.map((card) => [card.id, 'no-entry']));
  const cases = [];
  const verifiedNotes = [];
  for (const card of cards) {
    const found = entries.get(card.id);
    if (!found) continue;
    const { file, name, entry } = found;
    const where = `${name}: ${card.id}`;
    const fail = (message) => errors.push(`${where}: ${message}`);
    const documents = card.sourceIds
      .filter((sourceId) => captures.has(sourceId))
      .map((sourceId) => ({ id: sourceId, body: captures.get(sourceId) }));

    // Every quote must be verbatim in the capture it names, and that capture must be one of the card's.
    const checkAnchor = (anchor, label) => {
      if (!card.sourceIds.includes(anchor.sourceId))
        return fail(`${label}: ${anchor.sourceId} is not a source of this card`);
      if (!captures.has(anchor.sourceId))
        return fail(`${label}: capture ${anchor.sourceId} is missing or changed`);
      if (
        !resolveQuote(anchor.quote, {
          documents: [{ id: anchor.sourceId, body: captures.get(anchor.sourceId) }],
        })
      )
        fail(`${label}: quote not found in ${anchor.sourceId}: "${clipWords(anchor.quote, 12)}"`);
    };
    const checkQuoteValue = (value, label) => {
      if (typeof value !== 'string') return fail(`${label}: an anchor or issuer wording is a string`);
      if (wordCount(value) > MAX_QUOTE_WORDS) fail(`${label}: over ${MAX_QUOTE_WORDS} words`);
      else if (!resolveQuote(value, { documents })) fail(`${label}: not verbatim in the card's captures`);
    };
    entry.fixes.forEach((fix, i) => {
      if (fix.anchor) checkAnchor(fix.anchor, `fixes.${i}.anchor`);
      if (fix.adjudication?.anchor) checkAnchor(fix.adjudication.anchor, `fixes.${i}.adjudication.anchor`);
      for (const [value, label] of [
        [fix.corrected, `fixes.${i}.corrected`],
        [
          fix.adjudication?.decision === 'modified' ? fix.adjudication.corrected : undefined,
          `fixes.${i}.adjudication.corrected`,
        ],
      ])
        if (value !== undefined && fix.op === 'set' && isAnchorPath(fix.path)) checkQuoteValue(value, label);
    });
    for (const key of Object.keys(ADDED))
      entry[key].forEach((added, i) => {
        added.anchors.forEach((anchor, j) => checkAnchor(anchor, `${key}.${i}.anchors.${j}`));
        if (added.adjudication?.replacement) {
          const replacement = ADDED[key].item.safeParse(added.adjudication.replacement);
          if (!replacement.success)
            fail(`${key}.${i}.adjudication.replacement: ${replacement.error.issues[0].message}`);
          else
            replacement.data.anchors.forEach((anchor, j) =>
              checkAnchor(anchor, `${key}.${i}.replacement.anchors.${j}`),
            );
        }
        if (key === 'addedRules') checkQuoteValue(added.rule.issuerWording, `${key}.${i}.rule.issuerWording`);
      });
    entry.productNoteChanges.forEach((change, i) => {
      if (change.anchor) checkAnchor(change.anchor, `productNoteChanges.${i}.anchor`);
      if (change.adjudication?.anchor)
        checkAnchor(change.adjudication.anchor, `productNoteChanges.${i}.adjudication.anchor`);
      if (change.adjudication?.replacement) {
        const replacement = hintSchema.safeParse(change.adjudication.replacement);
        if (!replacement.success)
          fail(`productNoteChanges.${i}.adjudication.replacement: ${replacement.error.issues[0].message}`);
      }
      const hints = notesById.get(card.id)?.hints ?? [];
      if (change.hintIndex !== undefined && change.hintIndex >= hints.length)
        fail(`productNoteChanges.${i}: no hint ${change.hintIndex}`);
    });

    // Completeness: adjudicated file, every finding decided, drop verdict decided.
    const undecided = findingsOf(entry).filter((finding) => !finding.adjudication).length;
    if (!file.adjudicator || undecided || (entry.verdict === 'drop-card' && !entry.verdictAdjudication)) {
      statuses.set(card.id, 'awaiting-adjudication');
      continue;
    }
    if (entry.verdict === 'drop-card') {
      statuses.set(
        card.id,
        entry.verdictAdjudication.decision === 'accepted' ? 'dropped' : 'needs-reverification',
      );
      continue;
    }

    // Labels: draft (or an empty reference for an undrafted card) + accepted fixes and additions.
    const draftCase = draftById.get(card.id);
    const item = structuredClone(
      draftCase ?? {
        id: card.id,
        cardId: card.id,
        cardName: card.name.slice(0, 120),
        issuer: card.issuer,
        split: 'dev',
        sourceIds: card.sourceIds.slice(0, 4),
        reference: emptyReference(),
      },
    );
    const before = errors.length;
    const useSource = (sourceId) => {
      if (!item.sourceIds.includes(sourceId)) item.sourceIds.push(sourceId);
    };
    const removals = [];
    entry.fixes.forEach((fix, i) => {
      if (!applies(fix)) return;
      const spot = locate(item, fix.path);
      if (!spot) return fail(`fixes.${i}: ${fix.path} does not exist in the draft`);
      if (!isDeepStrictEqual(spot.parent[spot.key] ?? null, fix.current))
        return fail(
          `fixes.${i}: ${fix.path} is ${JSON.stringify(spot.parent[spot.key])}, not the stated current value`,
        );
      if (fix.op === 'remove') return removals.push({ ...spot, path: fix.path });
      const modified = fix.adjudication.decision === 'modified';
      const corrected = modified ? fix.adjudication.corrected : fix.corrected;
      const anchor = (modified && fix.adjudication.anchor) || fix.anchor;
      spot.parent[spot.key] = structuredClone(corrected);
      useSource(anchor.sourceId);
      const owner = anchorOwner(item.reference, fix.path);
      if (owner && !owner.anchors.includes(anchor.quote)) {
        if (fix.path.endsWith('.rateBps')) owner.anchors.unshift(anchor.quote);
        else owner.anchors.push(anchor.quote);
        owner.anchors.splice(4);
      }
    });
    removals
      .sort((a, b) => b.path.split('.').length - a.path.split('.').length || b.key - a.key)
      .forEach(({ parent, key }) => parent.splice(key, 1));
    const added = (key, build) =>
      entry[key].filter(applies).forEach((value) => {
        const final =
          value.adjudication.decision === 'modified'
            ? ADDED[key].item.parse(value.adjudication.replacement)
            : value;
        final.anchors.forEach((anchor) => useSource(anchor.sourceId));
        item.reference[key.replace(/^added/, '').replace(/^./, (c) => c.toLowerCase())].push(
          build(
            final,
            final.anchors.map((anchor) => anchor.quote),
          ),
        );
      });
    added('addedRules', (value, quotes) => ({ ...value.rule, anchors: quotes }));
    added('addedExclusions', (value, quotes) => ({ text: value.text, anchors: quotes }));
    added('addedIssues', (value, quotes) => ({ code: value.code, anchors: quotes }));
    if (errors.length > before) continue;

    const parsed = caseSchema.safeParse(item);
    if (!parsed.success) {
      fail(
        `verified labels fail the corpus schema: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      );
      continue;
    }
    const caseDocuments = parsed.data.sourceIds.map((sourceId) => ({
      id: sourceId,
      body: captures.get(sourceId) ?? '',
    }));
    try {
      checkCase(parsed.data, { documents: caseDocuments });
    } catch (error) {
      fail(`verified labels fail the corpus check: ${error.message}`);
      continue;
    }
    const long = [
      ...parsed.data.reference.rules.map((rule) => rule.issuerWording),
      ...Object.values(parsed.data.reference).flatMap((value) =>
        Array.isArray(value) ? value.flatMap((v) => v.anchors) : value.anchors,
      ),
    ].filter((quote) => wordCount(quote) > MAX_QUOTE_WORDS);
    if (long.length) {
      fail(`${long.length} anchor(s) or issuer wording(s) over ${MAX_QUOTE_WORDS} words; fix them first`);
      continue;
    }
    cases.push(parsed.data);
    statuses.set(card.id, entry.verdict);

    // Product notes: confirmed and fixed hints carry the verifier's anchor; dropped hints are removed.
    const hints = structuredClone(notesById.get(card.id)?.hints ?? []).map((hint) => ({
      ...hint,
      verification: 'unreviewed',
    }));
    const dropped = new Set();
    for (const change of entry.productNoteChanges.filter(applies)) {
      const modified = change.adjudication.decision === 'modified';
      const anchor = (modified && change.adjudication.anchor) || change.anchor;
      const hint = (modified && change.adjudication.replacement) || change.hint;
      const anchored = anchor
        ? {
            status: 'anchored',
            anchorMethod: 'verifier',
            anchor: anchor.quote,
            anchorSourceId: anchor.sourceId,
          }
        : {};
      if (change.action === 'drop') dropped.add(change.hintIndex);
      else if (change.action === 'add') hints.push({ ...hint, ...anchored, verification: 'added' });
      else {
        const base = change.action === 'fix' ? hint : hints[change.hintIndex];
        const { research: _r, researchSources: _s, ...rest } = base;
        hints[change.hintIndex] = {
          ...rest,
          ...anchored,
          verification: change.action === 'fix' ? 'fixed' : 'confirmed',
        };
      }
    }
    verifiedNotes.push({
      cardId: card.id,
      issuer: card.issuer,
      hints: hints.filter((_, i) => !dropped.has(i)),
    });
  }

  return { errors, cases, productNotes: verifiedNotes, statuses, entries, files: parsedFiles };
}

// ---- Outputs ---------------------------------------------------------------------------------------------
export function buildCorpus(cases, files, version = 'expansion.v1') {
  const models = [
    ...new Set(
      files.flatMap((file) => [file.data.verifier.model, file.data.adjudicator?.model]).filter(Boolean),
    ),
  ];
  return corpusV2Schema.parse({
    schemaVersion: 2,
    version,
    origin: 'real-issuer-captures',
    annotationStatus: 'agent-verified',
    description: `Catalog expansion: ${cases.length} cards from captured issuer pages. Labels drafted by scripts/draft-expansion-labels.mjs from LLM extractions, verified field by field against the captures by independent per-issuer verifier agents and adjudicated by a second agent pass (models: ${models.join(', ') || 'not recorded'}); not human-verified. Only cards with a complete, adjudicated verification are included; split is a placeholder. Generated by scripts/apply-expansion-verification.mjs.`,
    cases,
  });
}

/** Markdown summary per issuer: card statuses, fixes by field, adjudication decisions. Quotes no capture text. */
export function verificationReport({ cards, statuses, entries }) {
  const STATUS = [
    'confirmed',
    'fixed',
    'dropped',
    'needs-reverification',
    'awaiting-adjudication',
    'no-entry',
  ];
  const lines = [
    '# Expansion verification report',
    '',
    'Generated by `scripts/apply-expansion-verification.mjs` from `verification/*.json`. Cards counted as confirmed or fixed are in `corpus.json`; the others are not.',
    '',
    '## Cards by issuer',
    '',
    `| Issuer | Cards | ${STATUS.join(' | ')} |`,
    `| --- | --- |${STATUS.map(() => ' --- |').join('')}`,
  ];
  const issuers = [...new Set(cards.map((card) => card.issuer))];
  const totals = Object.fromEntries(STATUS.map((status) => [status, 0]));
  for (const issuer of issuers) {
    const ids = cards.filter((card) => card.issuer === issuer).map((card) => card.id);
    const counts = STATUS.map((status) => ids.filter((cardId) => statuses.get(cardId) === status).length);
    STATUS.forEach((status, i) => (totals[status] += counts[i]));
    lines.push(`| ${issuer} | ${ids.length} | ${counts.join(' | ')} |`);
  }
  lines.push(`| **Total** | ${cards.length} | ${STATUS.map((status) => totals[status]).join(' | ')} |`, '');

  const byField = new Map();
  const decisions = { accepted: 0, rejected: 0, modified: 0, pending: 0 };
  const additions = { addedRules: 0, addedExclusions: 0, addedIssues: 0, productNoteChanges: 0 };
  for (const { entry } of entries.values()) {
    for (const fix of entry.fixes) {
      const key = `${fix.op === 'remove' ? 'remove ' : ''}${generalPath(fix.path)}`;
      const row = byField.get(key) ?? { accepted: 0, rejected: 0, modified: 0, pending: 0 };
      row[fix.adjudication?.decision ?? 'pending']++;
      byField.set(key, row);
    }
    for (const finding of findingsOf(entry)) decisions[finding.adjudication?.decision ?? 'pending']++;
    for (const key of Object.keys(additions)) additions[key] += entry[key].length;
  }
  lines.push(
    '## Fixes by field',
    '',
    '| Field | accepted | modified | rejected | pending |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const [field, row] of [...byField].sort((a, b) => a[0].localeCompare(b[0])))
    lines.push(`| \`${field}\` | ${row.accepted} | ${row.modified} | ${row.rejected} | ${row.pending} |`);
  if (!byField.size) lines.push('| (none) | 0 | 0 | 0 | 0 |');
  lines.push(
    '',
    `Additions: ${additions.addedRules} rules, ${additions.addedExclusions} exclusions, ${additions.addedIssues} issues, ${additions.productNoteChanges} product-note changes.`,
    '',
    `All findings: ${decisions.accepted} accepted, ${decisions.modified} modified, ${decisions.rejected} rejected, ${decisions.pending} awaiting adjudication.`,
    '',
  );
  const dropped = [...entries.values()].filter(({ entry }) => entry.verdict === 'drop-card');
  if (dropped.length) {
    lines.push('## Drop-card verdicts', '');
    for (const { entry } of dropped)
      lines.push(`- \`${entry.cardId}\` (${statuses.get(entry.cardId)}): ${clipWords(entry.reason, 20)}`);
    lines.push('');
  }
  return lines.join('\n');
}
