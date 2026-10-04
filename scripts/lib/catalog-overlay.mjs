// Catalog overlay for catalog v3 (`evals/curation/expansion/catalog-overlay.json` and `merchants.json`): product
// structure the corpus labels cannot express (brand scope, chosen categories, gates, rotating quarters, checkout
// methods, closed-loop acceptance, store-credit programs), with an explicit disposition for every corpus `other`
// rule, every issue and every product hint. The corpus stays the eval truth and is never edited; the overlay patches
// a copy of each rule by index (`was` guards the index), adds rules, or holds rules and cards out.
//
// `checkOverlay` is the coverage check (Zod, references, dispositions) and also builds an in-memory draft catalog v3
// from the corpora, reward-programs.json, merchants.json and the overlay (`draftCatalogV3`) and parses it with
// `catalogV3Schema`, so every overlay decision is known to produce a valid catalog before the M5 builder exists.
// Verbatim checks of the anchors against the captures are in scripts/check-expansion-quotes.mjs.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { catalogV3Schema } from '../../packages/rewards-core/src/schema.ts';
import {
  CAP_PERIODS,
  EXCLUDABLE_PAYMENT_PATHS_V3,
  MERCHANT_CATEGORIES_V3,
  PAYMENT_PATHS_V3,
  REWARD_CATEGORIES_V3,
} from '../../packages/rewards-core/src/types.ts';
import { MAX_QUOTE_WORDS, wordCount } from './expansion-quotes.mjs';

/** What happened to a corpus `other` rule, issue or product hint in the catalog. */
export const DISPOSITIONS = ['modelled', 'field-unstated', 'rule-held-out', 'card-held-out', 'noted'];
/** How a `modelled` item is represented in catalog v3. */
export const MODELLED_AS = [
  'brand-scope', // rule.brandIds
  'brand-exclusion', // rule.excludedBrandIds
  'category', // recategorized to an existing or new reward category
  'choice', // card choice + rule.choice
  'automatic-choice', // card choice of kind automatic
  'gate', // rule.requires
  'rotating', // limitedTime with startsOn/endsOn
  'limited-time', // promotional or account-age rate
  'checkout-method', // required or excluded payment paths
  'closed-loop', // card acceptance
  'store-credit-program', // separate cash-back program with redemptionBrandIds
  'program-redemption', // redemptionBrandIds on an existing program
  'shared-cap', // rule.sharedCapId
  'base-rule', // which rule is the card's unconditional base
];
export const MAX_NOTE_WORDS = 60;

/** Default catalog dates for the draft built here (the capture date and the 30-day expiry the plan fixes); the
 * multi-batch build passes dates from the manifests (`inputs.verifiedAt`, `inputs.expiresAt`). */
export const DRAFT_VERIFIED_AT = '2026-10-02T00:00:00Z';
export const DRAFT_EXPIRES_AT = '2026-11-01T00:00:00Z';

const catalogId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const unique = (values) => new Set(values).size === values.length;
const idList = (max) => z.array(catalogId).max(max).refine(unique, 'IDs must be unique');
const text = (max) => z.string().trim().min(1).max(max);
const noteSchema = text(600).refine(
  (value) => wordCount(value) <= MAX_NOTE_WORDS,
  `a note is at most ${MAX_NOTE_WORDS} words`,
);
const quoteSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => wordCount(value) <= MAX_QUOTE_WORDS, `a quote is at most ${MAX_QUOTE_WORDS} words`);
export const anchorSchema = z.strictObject({ sourceId: catalogId, quote: quoteSchema });
const anchors = (min = 1) => z.array(anchorSchema).min(min).max(6);
const optionSchema = z.strictObject({ id: catalogId, label: text(120) });
const bps = z.number().int().min(0).max(10_000);
const capSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('unstated') }),
  z.strictObject({
    kind: z.literal('spend'),
    amountCents: z.number().int().min(1),
    period: z.enum(CAP_PERIODS),
    rateAfterCapBps: bps,
  }),
]);
const limitedTimeSchema = z
  .strictObject({ startsOn: z.iso.date().nullable(), endsOn: z.iso.date().nullable() })
  .nullable();
const choiceRefSchema = z.strictObject({ choiceId: catalogId, optionId: catalogId }).nullable();
const requiresSchema = z.array(z.strictObject({ gateId: catalogId, optionIds: idList(10).min(1) })).max(5);
/** v3 rule fields an overlay may set on a corpus rule or give an added rule. Rates and wording never change. */
const ruleFields = {
  category: z.enum(REWARD_CATEGORIES_V3),
  cap: capSchema,
  activation: z.enum(['none', 'enroll-once', 'recurring', 'unstated']),
  limitedTime: limitedTimeSchema,
  brandIds: idList(20),
  excludedBrandIds: idList(20),
  sharedCapId: catalogId.nullable(),
  choice: choiceRefSchema,
  requires: requiresSchema,
  requiredPaymentPaths: z.array(z.enum(PAYMENT_PATHS_V3)).max(5).refine(unique),
  excludedPaymentPaths: z.array(z.enum(EXCLUDABLE_PAYMENT_PATHS_V3)).max(4).refine(unique),
};
const dispositionFields = {
  disposition: z.enum(DISPOSITIONS),
  /** For `modelled`: how (at least one); otherwise empty. */
  how: z.array(z.enum(MODELLED_AS)).max(6).refine(unique),
  note: noteSchema,
};

export const rulePatchSchema = z.strictObject({
  index: z.number().int().min(0),
  /** Guards the index: the corpus rule's category and rate. */
  was: z.strictObject({ category: z.string(), rateBps: bps.nullable() }),
  ...dispositionFields,
  set: z.strictObject(ruleFields).partial().optional(),
  anchors: z.array(anchorSchema).max(6).optional(),
});
export const addedRuleSchema = z.strictObject({
  key: catalogId,
  /** Verbatim from one of the card's captures (checked by scripts/check-expansion-quotes.mjs). */
  issuerWording: text(200).refine(
    (value) => wordCount(value) <= MAX_QUOTE_WORDS,
    `issuer wording is at most ${MAX_QUOTE_WORDS} words`,
  ),
  rateBps: bps,
  paidOnPaymentBps: bps,
  usMerchantsOnly: z.boolean(),
  ...ruleFields,
  how: z.array(z.enum(MODELLED_AS)).min(1).max(6).refine(unique),
  note: noteSchema,
  anchors: anchors(),
});
export const choiceSchema = z.strictObject({
  id: catalogId,
  kind: z.enum(['chosen', 'automatic']),
  label: text(200),
  picks: z.number().int().min(1).max(5),
  options: z.array(optionSchema).min(2).max(30),
  defaultOptionIds: idList(5),
  anchors: anchors(),
});
const ruleRef = z.union([z.number().int().min(0), catalogId]);
export const itemDispositionSchema = z.strictObject({
  index: z.number().int().min(0),
  ...dispositionFields,
  /** Corpus rule indices or added-rule keys that model this item. */
  rules: z.array(ruleRef).max(30).optional(),
});
export const overlayCardSchema = z.strictObject({
  cardId: z.string().min(1),
  issuer: z.string().min(1),
  /** SHA-256 of the card's corpus case in canonical JSON (`stableJson`), pairing the entry with that case. Required
   * in pipeline batches (checked by scripts/lib/catalog-batches.mjs); the frozen `expansion.v1` overlay predates it. */
  corpusCaseSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  /** Why the card is left out of the catalog; null when it is included. */
  heldOut: noteSchema.nullable(),
  /** Store-credit cash-back program replacing the reward-programs.json `cash-back` mapping. */
  programId: catalogId.nullable(),
  acceptance: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('open-loop') }),
      z.strictObject({ kind: z.literal('closed-loop'), brandIds: idList(20).min(1), anchors: anchors() }),
    ])
    .default({ kind: 'open-loop' }),
  choices: z.array(choiceSchema).max(5).default([]),
  rules: z.array(rulePatchSchema).max(40).default([]),
  addedRules: z.array(addedRuleSchema).max(30).default([]),
  issues: z.array(itemDispositionSchema).default([]),
  hints: z.array(itemDispositionSchema).default([]),
});
export const gateSchema = z.strictObject({
  id: catalogId,
  question: text(200),
  options: z.array(optionSchema).min(2).max(10),
  anchors: anchors(),
});
export const storeProgramSchema = z.strictObject({
  id: catalogId,
  name: text(120),
  currency: z.literal('cash-back'),
  unitName: text(60),
  redemptionBrandIds: idList(20).min(1),
  anchors: anchors(),
});
export const programDetailSchema = z.strictObject({
  programId: catalogId,
  unitName: text(60),
  redemptionBrandIds: idList(20),
});

export const overlaySchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  annotationStatus: z.literal('agent-verified'),
  description: z.string().min(1),
  /** Store-credit cash-back programs split from `cash-back` (Verizon Dollars, OneKeyCash, ...). */
  programs: z.array(storeProgramSchema),
  /** Unit name and redemption brands for every program (reward-programs.json and `programs`). */
  programDetails: z.array(programDetailSchema),
  gates: z.array(gateSchema),
  cards: z.array(overlayCardSchema),
});

const merchantSourceSchema = z.strictObject({
  id: catalogId,
  title: text(200),
  url: z.url({ protocol: /^https$/ }),
  checkedOn: z.iso.date(),
});
export const merchantsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  description: z.string().min(1),
  brands: z.array(z.strictObject({ id: catalogId, name: text(120) })),
  sources: z.array(merchantSourceSchema),
  merchants: z.array(
    z.strictObject({
      id: catalogId,
      name: text(120),
      onlineRetail: z.boolean(),
      physicalGoods: z.boolean(),
      usMerchant: z.boolean(),
      expectedCategory: z.enum(MERCHANT_CATEGORIES_V3),
      mcc: z.strictObject({
        code: z
          .string()
          .regex(/^[0-9]{4}$/)
          .nullable(),
        confidence: z.enum(['low', 'medium', 'high']),
        sourceIds: z.array(catalogId).max(10),
      }),
      notes: z.string().max(1000),
      brandIds: idList(20),
    }),
  ),
});

const formatIssues = (prefix, error) =>
  error.issues.map((issue) => `${prefix}${issue.path.join('.')}: ${issue.message}`);

/** The base (non-variant) case of each card of a corpus, keyed by card ID. */
export function corpusCases(corpus) {
  const cases = new Map();
  for (const item of corpus.cases) if (!item.variant && !cases.has(item.cardId)) cases.set(item.cardId, item);
  return cases;
}

function mapCap(cap) {
  if (cap === null) return { kind: 'unstated' };
  if (cap.kind === 'none') return { kind: 'none' };
  return {
    kind: 'spend',
    amountCents: cap.amountCents,
    period: cap.period ?? 'year-unspecified',
    rateAfterCapBps: cap.rateAfterCapBps,
  };
}

/** A corpus rule as a v3 rule (before overlay patches): nulls become `unstated`/`false` as in catalog v2. */
export function corpusRuleToV3(rule, id, sourceIds) {
  return {
    id,
    category: rule.category,
    issuerWording: rule.issuerWording,
    rateBps: rule.rateBps,
    paidOnPaymentBps: rule.paidOnPaymentBps,
    cap: mapCap(rule.cap),
    activation: rule.activation ?? 'unstated',
    usMerchantsOnly: rule.usMerchantsOnly ?? false,
    excludedPaymentPaths: [],
    limitedTime:
      rule.limitedTime === null ? null : { startsOn: null, endsOn: rule.limitedTime.endsOn ?? null },
    sourceIds,
    brandIds: [],
    excludedBrandIds: [],
    sharedCapId: null,
    choice: null,
    requires: [],
    requiredPaymentPaths: [],
  };
}

// Amex excludes third-party buy now, pay later from U.S. online retail (as in catalog v2).
const REAL_EXCLUDED_PAYMENT_PATHS = { 'American Express': { 'online-retail': ['bnpl'] } };

/** The v3 card for a corpus case with its overlay entry applied, or null when the card is held out. */
export function applyOverlayCard(item, entry, { programId, statedValue }) {
  if (entry?.heldOut) return null;
  const sourceIds = item.sourceIds.slice(0, 10);
  const patches = new Map((entry?.rules ?? []).map((patch) => [patch.index, patch]));
  const rules = [];
  item.reference.rules.forEach((rule, index) => {
    const patch = patches.get(index);
    if (patch?.disposition === 'rule-held-out' || patch?.disposition === 'card-held-out') return;
    const v3 = corpusRuleToV3(rule, `${item.cardId}-r${index}`, sourceIds);
    if (entry === undefined)
      v3.excludedPaymentPaths = REAL_EXCLUDED_PAYMENT_PATHS[item.issuer]?.[rule.category] ?? [];
    rules.push({ ...v3, ...patch?.set });
  });
  for (const added of entry?.addedRules ?? []) {
    const { key, how: _how, note: _note, anchors: _anchors, ...fields } = added;
    rules.push({ id: `${item.cardId}-${key}`, ...fields, sourceIds });
  }
  return {
    id: item.cardId,
    name: item.cardName,
    shortName: item.cardName.slice(0, 60),
    issuer: item.issuer,
    programId,
    statedValueHundredthsOfCent: statedValue,
    acceptance:
      entry?.acceptance?.kind === 'closed-loop'
        ? { kind: 'closed-loop', brandIds: entry.acceptance.brandIds }
        : { kind: 'open-loop' },
    choices: (entry?.choices ?? []).map(({ anchors: _anchors, ...choice }) => choice),
    rules,
    exclusions: item.reference.exclusions.map((exclusion) => exclusion.text).slice(0, 20),
  };
}

// `checkedOn` in a manifest source is the Phase 9 freshness hook: the date a re-check found the capture unchanged.
const sourceOf = ({ id, title, url, capturedOn, checkedOn }) => ({
  id,
  title,
  url,
  checkedOn: checkedOn ?? capturedOn,
});

/**
 * An unpublished catalog v3 built from the committed inputs (corpora, reward programs, merchants, overlay and the
 * capture manifests), for checking the overlay. Rule IDs are `<cardId>-r<index>` or `<cardId>-<key>`; M5's builder
 * shortens them and fixes display names.
 */
export function draftCatalogV3({
  overlay,
  merchants,
  corpora,
  rewardPrograms,
  manifests,
  verifiedAt = DRAFT_VERIFIED_AT,
  expiresAt = DRAFT_EXPIRES_AT,
}) {
  const entries = new Map(overlay.cards.map((entry) => [entry.cardId, entry]));
  const mapping = new Map(rewardPrograms.cards.map((card) => [card.cardId, card]));
  const details = new Map(overlay.programDetails.map((detail) => [detail.programId, detail]));
  const programs = [
    ...rewardPrograms.programs.map((program) => ({
      id: program.id,
      name: program.name,
      currency: program.currency,
      unitName: details.get(program.id)?.unitName ?? 'points',
      valuation:
        program.basis === 'cash'
          ? { basis: 'cash', valueHundredthsOfCent: 100 }
          : program.basis === 'published-estimate'
            ? {
                basis: 'published-estimate',
                valueHundredthsOfCent: program.valueHundredthsOfCent,
                publisher: program.estimate.publisher,
                url: program.estimate.url,
                retrievedOn: program.estimate.readOn,
              }
            : program.basis === 'issuer-stated'
              ? {
                  basis: 'issuer-stated',
                  valueHundredthsOfCent: program.valueHundredthsOfCent,
                  sourceIds: [program.issuerStated.sourceId],
                }
              : { basis: 'none' },
      redemptionBrandIds: details.get(program.id)?.redemptionBrandIds ?? [],
    })),
    ...overlay.programs.map((program) => ({
      id: program.id,
      name: program.name,
      currency: 'cash-back',
      unitName: details.get(program.id)?.unitName ?? program.unitName,
      valuation: { basis: 'cash', valueHundredthsOfCent: 100 },
      redemptionBrandIds: program.redemptionBrandIds,
    })),
  ];
  const cards = [];
  for (const corpus of corpora)
    for (const [cardId, item] of corpusCases(corpus)) {
      const program = mapping.get(cardId);
      const entry = entries.get(cardId);
      const card = applyOverlayCard(item, entry, {
        programId: entry?.programId ?? program?.programId ?? 'missing-program',
        statedValue: program?.statedValueHundredthsOfCent ?? null,
      });
      if (card) cards.push(card);
    }
  const usedSources = new Set([
    ...cards.flatMap((card) => card.rules.flatMap((rule) => rule.sourceIds)),
    ...programs.flatMap((program) => program.valuation.sourceIds ?? []),
  ]);
  // A source captured for both corpora (chase-rewards-category-faq, same hash) is listed once, from the first
  // manifest (the expansion's later capture date).
  const sources = new Map();
  for (const manifest of manifests)
    for (const source of manifest.sources)
      if (usedSources.has(source.id) && !sources.has(source.id)) sources.set(source.id, sourceOf(source));
  for (const source of merchants.sources) sources.set(source.id, source);
  return {
    schemaVersion: 3,
    version: '2026-10-02.overlay-draft',
    verifiedAt,
    expiresAt,
    programs,
    brands: merchants.brands,
    gates: overlay.gates.map(({ anchors: _anchors, ...gate }) => gate),
    merchants: merchants.merchants,
    sources: [...sources.values()],
    cards,
  };
}

/**
 * Problems with the overlay and merchants files against the inputs, as strings (empty when they pass). With
 * `issuers`, coverage is checked only for those issuers' cards and the draft catalog only for their cards (for
 * per-issuer fragments).
 */
export function checkOverlay(inputs, { issuers = null } = {}) {
  const problems = [];
  const overlayParsed = overlaySchema.safeParse(inputs.overlay);
  const merchantsParsed = merchantsSchema.safeParse(inputs.merchants);
  if (!overlayParsed.success) problems.push(...formatIssues('overlay ', overlayParsed.error));
  if (!merchantsParsed.success) problems.push(...formatIssues('merchants ', merchantsParsed.error));
  if (problems.length) return problems;
  const overlay = overlayParsed.data;
  const merchants = merchantsParsed.data;
  const { corpora, notes, rewardPrograms, manifests } = inputs;
  const inScope = (issuer) => issuers === null || issuers.includes(issuer);

  const brandIds = new Set();
  for (const brand of merchants.brands) {
    if (brandIds.has(brand.id)) problems.push(`brand ${brand.id}: duplicate id`);
    brandIds.add(brand.id);
  }
  const gates = new Map();
  for (const gate of overlay.gates) {
    if (gates.has(gate.id)) problems.push(`gate ${gate.id}: duplicate id`);
    gates.set(gate.id, gate);
    if (!unique(gate.options.map((o) => o.id))) problems.push(`gate ${gate.id}: duplicate option ids`);
  }
  const sourceIds = new Set(manifests.flatMap((manifest) => manifest.sources.map((s) => s.id)));
  const checkAnchors = (at, list, allowed) => {
    for (const anchor of list ?? [])
      if (!(allowed ?? sourceIds).has(anchor.sourceId))
        problems.push(
          `${at}: anchor source ${anchor.sourceId} is not ${allowed ? "one of the card's" : 'a'} source`,
        );
  };
  for (const gate of overlay.gates) checkAnchors(`gate ${gate.id}`, gate.anchors);

  const basePrograms = new Map(rewardPrograms.programs.map((p) => [p.id, p]));
  const storePrograms = new Map();
  for (const program of overlay.programs) {
    if (basePrograms.has(program.id) || storePrograms.has(program.id))
      problems.push(`program ${program.id}: duplicate id`);
    storePrograms.set(program.id, program);
    checkAnchors(`program ${program.id}`, program.anchors);
    for (const id of program.redemptionBrandIds)
      if (!brandIds.has(id)) problems.push(`program ${program.id}: unknown brand ${id}`);
  }
  const detailIds = new Set();
  for (const detail of overlay.programDetails) {
    if (detailIds.has(detail.programId)) problems.push(`programDetails ${detail.programId}: duplicate`);
    detailIds.add(detail.programId);
    if (!basePrograms.has(detail.programId) && !storePrograms.has(detail.programId))
      problems.push(`programDetails ${detail.programId}: unknown program`);
    const store = storePrograms.get(detail.programId);
    if (
      store &&
      (store.unitName !== detail.unitName ||
        store.redemptionBrandIds.join() !== detail.redemptionBrandIds.join())
    )
      problems.push(`programDetails ${detail.programId}: differs from the store-credit program`);
    for (const id of detail.redemptionBrandIds)
      if (!brandIds.has(id)) problems.push(`programDetails ${detail.programId}: unknown brand ${id}`);
  }
  if (issuers === null)
    for (const id of [...basePrograms.keys(), ...storePrograms.keys()])
      if (!detailIds.has(id)) problems.push(`program ${id}: no programDetails entry`);

  const expansion = corpusCases(corpora[0]);
  const hintsByCard = new Map(notes.cards.map((card) => [card.cardId, card.hints]));
  const mapping = new Map(rewardPrograms.cards.map((card) => [card.cardId, card]));
  const entries = new Map();
  for (const entry of overlay.cards) {
    if (entries.has(entry.cardId)) problems.push(`card ${entry.cardId}: more than one overlay entry`);
    entries.set(entry.cardId, entry);
  }
  for (const [cardId, item] of expansion)
    if (inScope(item.issuer) && !entries.has(cardId)) problems.push(`card ${cardId}: no overlay entry`);

  const usedBrands = new Set(merchants.merchants.flatMap((m) => m.brandIds));
  for (const program of overlay.programs) program.redemptionBrandIds.forEach((id) => usedBrands.add(id));
  for (const detail of overlay.programDetails) detail.redemptionBrandIds.forEach((id) => usedBrands.add(id));
  const usedGates = new Set();
  const usedStorePrograms = new Set();

  for (const entry of overlay.cards) {
    const at = `card ${entry.cardId}`;
    const item = expansion.get(entry.cardId);
    if (!item) {
      problems.push(`${at}: not in the expansion corpus`);
      continue;
    }
    if (item.issuer !== entry.issuer) problems.push(`${at}: issuer is ${item.issuer}, not ${entry.issuer}`);
    const cardSources = new Set(item.sourceIds);
    const held = entry.heldOut !== null;
    const corpusRules = item.reference.rules;
    const hints = hintsByCard.get(entry.cardId) ?? [];

    // Program override: only a store-credit program replacing cash back.
    if (entry.programId !== null) {
      usedStorePrograms.add(entry.programId);
      if (!storePrograms.has(entry.programId))
        problems.push(`${at}: unknown store-credit program ${entry.programId}`);
      if (mapping.get(entry.cardId)?.programId !== 'cash-back')
        problems.push(`${at}: only a card mapped to cash-back can move to a store-credit program`);
    }
    if (entry.acceptance.kind === 'closed-loop') {
      checkAnchors(`${at} acceptance`, entry.acceptance.anchors, cardSources);
      for (const id of entry.acceptance.brandIds) {
        usedBrands.add(id);
        if (!brandIds.has(id)) problems.push(`${at} acceptance: unknown brand ${id}`);
      }
    }
    const choices = new Map(entry.choices.map((choice) => [choice.id, choice]));
    for (const choice of entry.choices)
      checkAnchors(`${at} choice ${choice.id}`, choice.anchors, cardSources);

    const checkFields = (where, fields) => {
      for (const id of [...(fields.brandIds ?? []), ...(fields.excludedBrandIds ?? [])]) {
        usedBrands.add(id);
        if (!brandIds.has(id)) problems.push(`${where}: unknown brand ${id}`);
      }
      for (const requirement of fields.requires ?? []) {
        usedGates.add(requirement.gateId);
        const gate = gates.get(requirement.gateId);
        if (!gate) problems.push(`${where}: unknown gate ${requirement.gateId}`);
        else if (requirement.optionIds.some((id) => !gate.options.some((o) => o.id === id)))
          problems.push(`${where}: unknown option of gate ${requirement.gateId}`);
      }
      if (
        fields.choice &&
        !choices.get(fields.choice.choiceId)?.options.some((o) => o.id === fields.choice.optionId)
      )
        problems.push(`${where}: unknown choice option ${fields.choice.choiceId}/${fields.choice.optionId}`);
    };
    const checkDisposition = (where, item, { allowHeld }) => {
      if (held && item.disposition !== 'card-held-out')
        problems.push(`${where}: the card is held out, so the disposition is card-held-out`);
      if (!held && item.disposition === 'card-held-out')
        problems.push(`${where}: card-held-out on a card that is not held out`);
      if (item.disposition === 'modelled' && item.how.length === 0)
        problems.push(`${where}: modelled needs at least one "how"`);
      if (item.disposition !== 'modelled' && item.how.length > 0)
        problems.push(`${where}: "how" is only for modelled items`);
      if (!allowHeld && item.disposition === 'rule-held-out')
        problems.push(`${where}: rule-held-out applies to rules only`);
    };

    // The engine reads only limitedTime dates, so an account-age rate with no dates would always apply (O20).
    const dateless = (fields) =>
      fields.limitedTime &&
      !fields.limitedTime.startsOn &&
      !fields.limitedTime.endsOn &&
      !fields.requires?.length;
    const datelessProblem = 'a limited-time rule with no dates needs a gate';
    const patched = new Map();
    for (const patch of entry.rules) {
      const where = `${at} rule ${patch.index}`;
      const rule = corpusRules[patch.index];
      if (!rule) {
        problems.push(`${where}: no such corpus rule`);
        continue;
      }
      if (patched.has(patch.index)) problems.push(`${where}: patched more than once`);
      patched.set(patch.index, patch);
      if (patch.was.category !== rule.category || patch.was.rateBps !== rule.rateBps)
        problems.push(
          `${where}: was ${patch.was.category}/${patch.was.rateBps}, corpus has ${rule.category}/${rule.rateBps}`,
        );
      checkDisposition(where, patch, { allowHeld: true });
      const dropped = patch.disposition === 'rule-held-out' || patch.disposition === 'card-held-out';
      if (dropped && patch.set) problems.push(`${where}: a held-out rule sets no fields`);
      if (!dropped && patch.set && !(patch.anchors ?? []).length)
        problems.push(`${where}: a patch that sets fields needs an anchor`);
      checkAnchors(where, patch.anchors, cardSources);
      if (patch.set) checkFields(where, patch.set);
      const result = { ...rule, ...patch.set };
      if (!dropped) {
        if (rule.rateBps === null) problems.push(`${where}: a rule without a rate must be held out`);
        if (rule.category === 'other' && result.category === 'other' && !(result.brandIds ?? []).length)
          problems.push(`${where}: an other rule must be brand-scoped, recategorized or held out`);
        if (result.cap?.kind === 'spend' && result.cap.rateAfterCapBps === null)
          problems.push(`${where}: a spend cap needs an after-cap rate`);
        if (dateless(result)) problems.push(`${where}: ${datelessProblem}`);
      }
    }
    if (!held)
      corpusRules.forEach((rule, index) => {
        if (patched.has(index)) return;
        if (rule.category === 'other') problems.push(`${at} rule ${index}: other rule without a disposition`);
        else if (rule.rateBps === null)
          problems.push(`${at} rule ${index}: rule without a rate needs a disposition`);
        else if (rule.cap?.kind === 'spend' && rule.cap.rateAfterCapBps === null)
          problems.push(`${at} rule ${index}: spend cap without an after-cap rate needs a disposition`);
        else if (dateless(rule)) problems.push(`${at} rule ${index}: ${datelessProblem}`);
      });
    else
      corpusRules.forEach((rule, index) => {
        if (rule.category === 'other' && !patched.has(index))
          problems.push(`${at} rule ${index}: other rule without a disposition`);
      });

    const keys = new Set();
    for (const added of entry.addedRules) {
      const where = `${at} added ${added.key}`;
      if (keys.has(added.key)) problems.push(`${where}: duplicate key`);
      keys.add(added.key);
      if (held) problems.push(`${where}: a held-out card adds no rules`);
      checkAnchors(where, added.anchors, cardSources);
      checkFields(where, added);
      if (added.category === 'other' && !added.brandIds.length)
        problems.push(`${where}: an other rule must be brand-scoped`);
      if (dateless(added)) problems.push(`${where}: ${datelessProblem}`);
    }
    const refOk = (ref) => (typeof ref === 'number' ? ref < corpusRules.length : keys.has(ref));
    const checkItems = (kind, list, count) => {
      const seen = new Set();
      for (const item of list) {
        const where = `${at} ${kind} ${item.index}`;
        if (item.index >= count) problems.push(`${where}: no such ${kind}`);
        if (seen.has(item.index)) problems.push(`${where}: more than one disposition`);
        seen.add(item.index);
        checkDisposition(where, item, { allowHeld: false });
        for (const ref of item.rules ?? []) if (!refOk(ref)) problems.push(`${where}: unknown rule ${ref}`);
      }
      for (let index = 0; index < count; index++)
        if (!seen.has(index)) problems.push(`${at} ${kind} ${index}: no disposition`);
    };
    checkItems('issue', entry.issues, item.reference.issues.length);
    checkItems('hint', entry.hints, hints.length);
  }

  if (issuers === null) {
    for (const id of brandIds) if (!usedBrands.has(id)) problems.push(`brand ${id}: unused`);
    for (const id of gates.keys()) if (!usedGates.has(id)) problems.push(`gate ${id}: unused`);
    for (const id of storePrograms.keys())
      if (!usedStorePrograms.has(id)) problems.push(`program ${id}: unused`);
  }
  for (const merchant of merchants.merchants)
    for (const id of merchant.brandIds)
      if (!brandIds.has(id)) problems.push(`merchant ${merchant.id}: unknown brand ${id}`);
  if (problems.length) return problems;

  // Build the draft catalog and parse it; for fragments, only the fragment's issuers' cards (plus the real cards).
  const scoped =
    issuers === null
      ? corpora
      : [
          { ...corpora[0], cases: corpora[0].cases.filter((item) => inScope(item.issuer)) },
          ...corpora.slice(1),
        ];
  const { verifiedAt, expiresAt } = inputs;
  const draft = draftCatalogV3({
    overlay,
    merchants,
    corpora: scoped,
    rewardPrograms,
    manifests,
    verifiedAt,
    expiresAt,
  });
  if (issuers !== null) {
    const used = new Set(draft.cards.map((card) => card.programId));
    draft.programs = draft.programs.filter((program) => used.has(program.id));
  }
  const parsed = catalogV3Schema.safeParse(draft);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const [list, index, ...rest] = issue.path;
      const owner = list === 'cards' && typeof index === 'number' ? `card ${draft.cards[index].id} ` : '';
      problems.push(
        `draft catalog ${owner}${owner ? rest.join('.') : issue.path.join('.')}: ${issue.message}`,
      );
    }
  return problems;
}

/** Overlay and merchants anchors that must be verbatim in the capture they name: [path, { sourceId, quote }]. */
export function overlayAnchors(overlay) {
  const out = [];
  const add = (path, list) =>
    (list ?? []).forEach((anchor, i) => out.push([`${path}.anchors[${i}]`, anchor]));
  for (const program of overlay.programs ?? []) add(`programs.${program.id}`, program.anchors);
  for (const gate of overlay.gates ?? []) add(`gates.${gate.id}`, gate.anchors);
  for (const card of overlay.cards ?? []) {
    const at = `cards.${card.cardId}`;
    if (card.acceptance?.kind === 'closed-loop') add(`${at}.acceptance`, card.acceptance.anchors);
    for (const choice of card.choices ?? []) add(`${at}.choices.${choice.id}`, choice.anchors);
    for (const patch of card.rules ?? []) add(`${at}.rules.${patch.index}`, patch.anchors);
    for (const added of card.addedRules ?? []) add(`${at}.addedRules.${added.key}`, added.anchors);
  }
  return out;
}

/** Counts for reports: dispositions by kind and type, modelled-as counts, objects added. */
export function overlayStats(overlay, merchants) {
  const dispositions = { rule: {}, issue: {}, hint: {} };
  const how = {};
  const bump = (table, key) => (table[key] = (table[key] ?? 0) + 1);
  for (const card of overlay.cards) {
    for (const [kind, list] of [
      ['rule', card.rules],
      ['issue', card.issues],
      ['hint', card.hints],
    ])
      for (const item of list ?? []) {
        bump(dispositions[kind], item.disposition);
        for (const h of item.how ?? []) bump(how, h);
      }
    for (const added of card.addedRules ?? []) for (const h of added.how) bump(how, `added:${h}`);
  }
  return {
    cards: overlay.cards.length,
    heldOutCards: overlay.cards.filter((card) => card.heldOut).map((card) => card.cardId),
    closedLoop: overlay.cards.filter((card) => card.acceptance?.kind === 'closed-loop').length,
    choices: overlay.cards.reduce((n, card) => n + (card.choices?.length ?? 0), 0),
    addedRules: overlay.cards.reduce((n, card) => n + (card.addedRules?.length ?? 0), 0),
    gates: overlay.gates.length,
    storePrograms: overlay.programs.length,
    brands: merchants.brands.length,
    dispositions,
    how,
  };
}

/** Reads the committed overlay, merchants and their inputs from the repository root. */
export async function loadOverlayInputs(root) {
  const read = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
  return {
    overlay: await read('evals/curation/expansion/catalog-overlay.json'),
    merchants: await read('evals/curation/expansion/merchants.json'),
    corpora: [
      await read('evals/curation/expansion/corpus.json'),
      await read('evals/curation/real/corpus.v2.json'),
    ],
    notes: await read('evals/curation/expansion/product-notes.verified.json'),
    rewardPrograms: await read('evals/curation/expansion/reward-programs.json'),
    manifests: [
      await read('evals/curation/expansion/manifest.json'),
      await read('evals/curation/real/manifest.json'),
    ],
  };
}
