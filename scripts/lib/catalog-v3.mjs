// Catalog v3 build (Stage 2 M5): the release catalog from the committed inputs, never from model output.
//
// Inputs (via loadOverlayInputs): the expansion corpus (`expansion.v1`, 173 cards), the real corpus
// (`real.v2.2`, 7 cards), reward-programs.json, merchants.json, catalog-overlay.json and both capture manifests.
// `draftCatalogV3` (scripts/lib/catalog-overlay.mjs) applies the overlay; this module then fixes what a release
// needs: display names and short names, short stable rule IDs, rule order, the release version and dates, and
// drops programs, brands and gates that no included card, merchant or program uses. The seven real cards keep the
// names, rule IDs and rule semantics of release 1 (`CATALOG_V2`, `2026-09-29.real.1`); `checkRealCards` fails the
// build if any of them differs.
import { catalogV3Schema, CATALOG_V3_LIMITS } from '../../packages/rewards-core/src/schema.ts';
import { isUnconditionalRuleV3 } from '../../packages/rewards-core/src/rules-v3.ts';
import { checkOverlay, corpusCases, draftCatalogV3, overlaySchema } from './catalog-overlay.mjs';

export const CATALOG_V3_VERSION = '2026-10-02.expansion.1';
export const CATALOG_V3_VERIFIED_AT = '2026-10-02T00:00:00Z';
export const CATALOG_V3_EXPIRES_AT = '2026-11-01T00:00:00Z';
/** The size budget M5 targets: 75% of the 1 MiB contract limit, for both JSON and JSONB text. */
export const CATALOG_V3_BYTE_BUDGET = Math.floor(CATALOG_V3_LIMITS.bytes * 0.75);

/** Release 1 display names and rule-ID prefixes of the real cards (as in scripts/build-catalog-v2.mjs). */
export const REAL_CARDS = {
  'citi-double-cash': { name: 'Citi Double Cash', shortName: 'Double Cash', prefix: 'double-cash' },
  'wells-fargo-active-cash': {
    name: 'Wells Fargo Active Cash',
    shortName: 'Active Cash',
    prefix: 'active-cash',
  },
  'capital-one-quicksilver': {
    name: 'Capital One Quicksilver',
    shortName: 'Quicksilver',
    prefix: 'quicksilver',
  },
  'capital-one-savor': { name: 'Capital One Savor', shortName: 'Savor', prefix: 'savor' },
  'chase-freedom-unlimited': {
    name: 'Chase Freedom Unlimited',
    shortName: 'Freedom Unlimited',
    prefix: 'freedom-unlimited',
  },
  'amex-blue-cash-everyday': {
    name: 'American Express Blue Cash Everyday',
    shortName: 'Blue Cash Everyday',
    prefix: 'bce',
  },
  'amex-blue-cash-preferred': {
    name: 'American Express Blue Cash Preferred',
    shortName: 'Blue Cash Preferred',
    prefix: 'bcp',
  },
};

/**
 * Corpus exclusions left out of the catalog because, listed next to the card's other exclusions, they would repeat
 * more than 25 consecutive words of a capture (general rule 22; found by scripts/check-expansion-quotes.mjs, which
 * scans CATALOG_V3). Matched by the start of the text; the build fails if one is no longer in the corpus. The corpus
 * keeps them, as separate labelled exclusions.
 */
export const QUOTE_LIMIT_OMISSIONS = {
  'barclays-old-navy-encore-mastercard': ['In addition, any transaction amount paid with earned rewards'],
  'barclays-banana-republic-encore-mastercard': [
    'In addition, any transaction amount paid with earned rewards',
  ],
  'barclays-athleta-encore-mastercard': ['In addition, any transaction amount paid with earned rewards'],
  'capital-one-venture-x': ['Earnings will apply to net purchases'],
  'capital-one-williams-sonoma-key-rewards-visa': [
    'Purchases made using promotional financing plans',
    'Installation Services, volume gift card purchases',
  ],
  'wells-fargo-autograph': ['Overdraft protection advances'],
  'wells-fargo-autograph-journey': ['Overdraft protection advances'],
};

/** Short names that the generic rule in `shortNameOf` would get wrong. */
const SHORT_NAMES = {
  'amex-gold': 'Amex Gold',
  'amex-platinum': 'Amex Platinum',
  'citi-macys-amex': "Macy's Amex",
  'citi-bloomingdales-amex': "Bloomingdale's Amex",
  'citi-costco-anywhere-visa': 'Costco Anywhere Visa',
  'synchrony-amazon-store-card': 'Amazon Store Card',
  'synchrony-amazon-secured-card': 'Amazon Secured Card',
  'synchrony-venmo-credit-card': 'Venmo Credit Card',
  'synchrony-newegg-store-credit-card': 'Newegg Store Card',
  'synchrony-harbor-freight-credit-card': 'Harbor Freight Card',
  'synchrony-whbm-mastercard': 'WHBM Mastercard',
  'us-bank-edward-jones-triple-rewards': 'Edward Jones Triple Rewards',
};
const ISSUER_PREFIXES = [
  'American Express ',
  'Bank of America ',
  'Capital One ',
  'Chase ',
  'Citi ',
  'U.S. Bank ',
  'Wells Fargo ',
];

/**
 * A card's short name: the corpus name's first alias (the second when the first is one word, as in
 * "Citi / AAdvantage …"), without the issuer in front, "American Express" inside a co-brand name, "from Barclays",
 * "credit card" and a trailing "Card" ("U.S. Bank Cash+ Visa Signature Card" → "Cash+ Visa Signature").
 */
export function shortNameOf(cardId, name) {
  if (SHORT_NAMES[cardId]) return SHORT_NAMES[cardId];
  const aliases = name.split(' / ');
  let short = aliases.length > 1 && !aliases[0].includes(' ') ? aliases[1] : aliases[0];
  short = short.replace(/\s*\(.*\)$/, '');
  for (const prefix of ISSUER_PREFIXES)
    if (short.startsWith(prefix) && short.length > prefix.length + 3) {
      short = short.slice(prefix.length);
      break;
    }
  short = short
    .replace(/ American Express\b/, '')
    .replace(/ from (Barclays|Citi)$/, '')
    .replace(/\s+credit card\b/i, '')
    .replace(/\s+Card$/, '');
  return short.slice(0, 60);
}

const ID_ISSUER_PREFIXES = /^(amex|boa|barclays|capital-one|chase|citi|synchrony|us-bank|wells-fargo)-/;
const ID_PRODUCT_SUFFIXES =
  /(-world-elite-mastercard|-world-elite|-world-mastercard|-mastercard|-visa-signature|-visa-card|-visa|-credit-card|-card)$/;

/**
 * A card's rule-ID prefix: the card ID without the issuer in front or a network/product word at the end
 * (`capital-one-williams-sonoma-key-rewards-visa` → `williams-sonoma-key-rewards`). Uniqueness is checked over the
 * whole catalog.
 */
export function rulePrefixOf(cardId) {
  const stripped = cardId.replace(ID_ISSUER_PREFIXES, '').replace(ID_PRODUCT_SUFFIXES, '');
  return stripped.length >= 3 ? stripped : cardId;
}

const CATEGORY_SLUGS = {
  'all-purchases': 'all',
  'online-retail': 'online',
  'online-shopping': 'shopping',
  'department-stores': 'dept',
  'home-improvement': 'home',
  'wholesale-clubs': 'club',
  drugstores: 'drug',
};

/**
 * Short, stable rule IDs: `<prefix>-base` for the card's unconditional base rule, otherwise `<prefix>-<what>` from
 * the rule's own fields (chosen option, brand or category, gate answer, required payment path, start month), with
 * `-2`, `-3` for rules that would still collide. Built from what the rule is, not its position, so a later corpus
 * revision that reorders rules keeps the IDs (the extension stores usage per rule ID).
 */
export function ruleIdsFor(prefix, rules, isBase) {
  const seen = new Map();
  return rules.map((rule) => {
    if (isBase(rule)) return `${prefix}-base`;
    const parts = [
      rule.choice?.optionId ?? rule.brandIds[0] ?? CATEGORY_SLUGS[rule.category] ?? rule.category,
    ];
    for (const requirement of rule.requires) parts.push(requirement.optionIds[0]);
    parts.push(...rule.requiredPaymentPaths);
    if (rule.limitedTime?.startsOn) parts.push(rule.limitedTime.startsOn.slice(0, 7));
    const stem = `${prefix}-${parts.join('-')}`;
    const count = (seen.get(stem) ?? 0) + 1;
    seen.set(stem, count);
    return count === 1 ? stem : `${stem}-${count}`;
  });
}

const isUnconditionalBase = (rule) => rule.category === 'all-purchases' && isUnconditionalRuleV3(rule);

/** Base first, then by rate (highest first), keeping the corpus order for ties (as in catalog v2). */
const byBaseThenRate = (rules) =>
  rules
    .map((rule, index) => ({ rule, index }))
    .sort(
      (a, b) =>
        Number(isUnconditionalBase(b.rule)) - Number(isUnconditionalBase(a.rule)) ||
        b.rule.rateBps - a.rule.rateBps ||
        a.index - b.index,
    )
    .map(({ rule }) => rule);

/** Release-1 rule IDs (`<prefix>-base`, `<prefix>-<category>`), which the real cards keep. */
const realRuleId = (prefix, rule) =>
  `${prefix}-${rule.category === 'all-purchases' ? 'base' : rule.category}`;

/**
 * The release catalog v3 from `loadOverlayInputs` (parsed by `catalogV3Schema`). Throws when the overlay coverage
 * check fails, the catalog is invalid or over the byte budget.
 */
export function buildCatalogV3(inputs) {
  const problems = checkOverlay(inputs);
  if (problems.length) throw new Error(`The overlay check fails:\n- ${problems.join('\n- ')}`);
  const draft = draftCatalogV3({ ...inputs, overlay: overlaySchema.parse(inputs.overlay) });
  const realIds = new Set(corpusCases(inputs.corpora[1]).keys());
  const renamed = new Map(); // old rule ID → new rule ID, for shared caps
  const cards = draft.cards.map((card) => {
    const real = REAL_CARDS[card.id];
    if (realIds.has(card.id) && !real) throw new Error(`No release-1 metadata for real card ${card.id}`);
    const rules = byBaseThenRate(card.rules);
    const ids = real
      ? rules.map((rule) => realRuleId(real.prefix, rule))
      : ruleIdsFor(rulePrefixOf(card.id), rules, isUnconditionalBase);
    rules.forEach((rule, i) => renamed.set(rule.id, ids[i]));
    const omit = QUOTE_LIMIT_OMISSIONS[card.id] ?? [];
    for (const start of omit)
      if (!card.exclusions.some((text) => text.startsWith(start)))
        throw new Error(`${card.id}: no exclusion starts with "${start}"`);
    return {
      ...card,
      exclusions: card.exclusions.filter((text) => !omit.some((start) => text.startsWith(start))),
      name: real?.name ?? card.name,
      shortName: real?.shortName ?? shortNameOf(card.id, card.name),
      rules: rules.map((rule, i) => ({ ...rule, id: ids[i] })),
    };
  });
  if (renamed.size !== new Set(renamed.values()).size) throw new Error('Rule IDs collide');

  // Keep only the programs, brands and gates something in the catalog uses.
  const programIds = new Set(cards.map((card) => card.programId));
  const programs = draft.programs.filter((program) => programIds.has(program.id));
  const gateIds = new Set(
    cards.flatMap((card) => card.rules.flatMap((r) => r.requires.map((q) => q.gateId))),
  );
  const gates = draft.gates.filter((gate) => gateIds.has(gate.id));
  const brandIds = new Set([
    ...draft.merchants.flatMap((m) => m.brandIds),
    ...programs.flatMap((p) => p.redemptionBrandIds),
    ...cards.flatMap((card) => [
      ...(card.acceptance.kind === 'closed-loop' ? card.acceptance.brandIds : []),
      ...card.rules.flatMap((r) => [...r.brandIds, ...r.excludedBrandIds]),
    ]),
  ]);
  const brands = draft.brands.filter((brand) => brandIds.has(brand.id));
  const sourceIds = new Set([
    ...cards.flatMap((card) => card.rules.flatMap((r) => r.sourceIds)),
    ...programs.flatMap((p) => p.valuation.sourceIds ?? []),
    ...draft.merchants.flatMap((m) => m.mcc.sourceIds),
  ]);
  const sources = draft.sources.filter((source) => sourceIds.has(source.id));

  const catalog = catalogV3Schema.parse({
    schemaVersion: 3,
    version: CATALOG_V3_VERSION,
    verifiedAt: CATALOG_V3_VERIFIED_AT,
    expiresAt: CATALOG_V3_EXPIRES_AT,
    programs,
    brands,
    gates,
    merchants: draft.merchants,
    sources,
    cards,
  });
  const bytes = jsonBytes(catalog);
  if (bytes > CATALOG_V3_BYTE_BUDGET || jsonbTextBytes(catalog) > CATALOG_V3_BYTE_BUDGET)
    throw new Error(`Catalog is over the ${CATALOG_V3_BYTE_BUDGET}-byte budget (${bytes} bytes)`);
  return catalog;
}

/**
 * Differences between the real cards of a catalog v3 and release 1 (catalog v2), as strings. Names, rule IDs,
 * wording, rates, caps, activation, U.S.-only, excluded payment paths, end dates, sources and exclusions must
 * match; v3 adds only conditions that are empty for these cards. Double Cash's ThankYou points at the stated 1¢
 * replace v2's `pointValueHundredthsOfCent` 100; the other six earn cash back.
 */
export function checkRealCards(catalog, catalogV2) {
  const problems = [];
  const programs = new Map(catalog.programs.map((p) => [p.id, p]));
  for (const old of catalogV2.cards) {
    const card = catalog.cards.find((c) => c.id === old.id);
    if (!card) {
      problems.push(`${old.id}: missing`);
      continue;
    }
    const at = (what) => `${old.id} ${what}`;
    for (const key of ['name', 'shortName', 'issuer'])
      if (card[key] !== old[key]) problems.push(at(`${key} ${card[key]} ≠ ${old[key]}`));
    if (JSON.stringify(card.exclusions) !== JSON.stringify(old.exclusions))
      problems.push(at('exclusions differ'));
    const program = programs.get(card.programId);
    const value = card.statedValueHundredthsOfCent ?? program?.valuation.valueHundredthsOfCent ?? null;
    const currency = program?.currency === 'cash-back' ? 'cash-back' : 'points';
    if (currency !== old.rewardCurrency) problems.push(at(`currency ${currency} ≠ ${old.rewardCurrency}`));
    if (value !== (old.pointValueHundredthsOfCent ?? 100))
      problems.push(at(`unit value ${value} ≠ ${old.pointValueHundredthsOfCent}`));
    if (card.acceptance.kind !== 'open-loop' || card.choices.length) problems.push(at('gained v3 structure'));
    if (card.rules.length !== old.rules.length) problems.push(at('rule count differs'));
    old.rules.forEach((oldRule, i) => {
      const rule = card.rules[i];
      if (!rule) return;
      const { limitedTime, ...rest } = oldRule;
      const mine = Object.fromEntries(Object.keys(rest).map((key) => [key, rule[key]]));
      if (JSON.stringify(mine) !== JSON.stringify(rest)) problems.push(at(`rule ${oldRule.id} differs`));
      const ends = rule.limitedTime === null ? null : { endsOn: rule.limitedTime.endsOn };
      if (JSON.stringify(ends) !== JSON.stringify(limitedTime) || rule.limitedTime?.startsOn)
        problems.push(at(`rule ${oldRule.id} time limit differs`));
      if (
        rule.brandIds.length ||
        rule.excludedBrandIds.length ||
        rule.sharedCapId ||
        rule.choice ||
        rule.requires.length ||
        rule.requiredPaymentPaths.length
      )
        problems.push(at(`rule ${oldRule.id} gained a v3 condition`));
    });
  }
  return problems;
}

/** UTF-8 bytes of the compact JSON, what `catalogV3Schema` measures. */
export const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));

/**
 * UTF-8 bytes of PostgreSQL's JSONB text form (`payload::text`, what `valid_catalog_v3` measures with
 * `octet_length`): the compact JSON plus one space after every key's colon and every element's comma. Key order
 * differs in JSONB but not the length.
 */
export function jsonbTextBytes(value) {
  let spaces = 0;
  const walk = (node) => {
    if (Array.isArray(node)) {
      spaces += Math.max(node.length - 1, 0);
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      const values = Object.values(node);
      spaces += values.length + Math.max(values.length - 1, 0);
      values.forEach(walk);
    }
  };
  walk(value);
  return jsonBytes(value) + spaces;
}

/** Counts for the build report. */
export function catalogStats(catalog) {
  const rules = catalog.cards.flatMap((card) => card.rules);
  const count = (list, test) => list.filter(test).length;
  const programsByBasis = {};
  const cardsByBasis = {};
  const programs = new Map(catalog.programs.map((p) => [p.id, p]));
  for (const program of catalog.programs)
    programsByBasis[program.valuation.basis] = (programsByBasis[program.valuation.basis] ?? 0) + 1;
  for (const card of catalog.cards) {
    const basis =
      card.statedValueHundredthsOfCent !== null
        ? 'card-stated'
        : programs.get(card.programId).valuation.basis;
    cardsByBasis[basis] = (cardsByBasis[basis] ?? 0) + 1;
  }
  const sharedCaps = new Set(
    catalog.cards.flatMap((card) =>
      card.rules.filter((r) => r.sharedCapId).map((r) => `${card.id}/${r.sharedCapId}`),
    ),
  );
  return {
    cards: catalog.cards.length,
    rules: rules.length,
    maxRulesPerCard: Math.max(...catalog.cards.map((card) => card.rules.length)),
    sources: catalog.sources.length,
    programs: catalog.programs.length,
    programsByBasis,
    cardsByBasis,
    brands: catalog.brands.length,
    gates: catalog.gates.length,
    merchants: catalog.merchants.length,
    closedLoopCards: count(catalog.cards, (card) => card.acceptance.kind === 'closed-loop'),
    cardsWithChoices: count(catalog.cards, (card) => card.choices.length > 0),
    choices: catalog.cards.reduce((n, card) => n + card.choices.length, 0),
    automaticChoices: catalog.cards.reduce(
      (n, card) => n + count(card.choices, (c) => c.kind === 'automatic'),
      0,
    ),
    cardsWithStatedValue: count(catalog.cards, (card) => card.statedValueHundredthsOfCent !== null),
    storeCreditPrograms: count(catalog.programs, (p) => p.redemptionBrandIds.length > 0),
    rulesByCategory: Object.fromEntries(
      [...new Set(rules.map((r) => r.category))]
        .sort()
        .map((category) => [category, count(rules, (r) => r.category === category)]),
    ),
    brandScopedRules: count(rules, (r) => r.brandIds.length > 0),
    brandExcludingRules: count(rules, (r) => r.excludedBrandIds.length > 0),
    choiceRules: count(rules, (r) => r.choice !== null),
    gatedRules: count(rules, (r) => r.requires.length > 0),
    requiredPaymentPathRules: count(rules, (r) => r.requiredPaymentPaths.length > 0),
    excludedPaymentPathRules: count(rules, (r) => r.excludedPaymentPaths.length > 0),
    rotatingRules: count(rules, (r) => r.limitedTime?.startsOn || r.limitedTime?.endsOn),
    datelessLimitedTimeRules: count(
      rules,
      (r) => r.limitedTime && !r.limitedTime.startsOn && !r.limitedTime.endsOn,
    ),
    sharedCaps: sharedCaps.size,
    spendCapRules: count(rules, (r) => r.cap.kind === 'spend'),
    unstatedCapRules: count(rules, (r) => r.cap.kind === 'unstated'),
    activationRules: count(rules, (r) => r.activation === 'enroll-once' || r.activation === 'recurring'),
    usOnlyRules: count(rules, (r) => r.usMerchantsOnly),
    jsonBytes: jsonBytes(catalog),
    jsonbTextBytes: jsonbTextBytes(catalog),
  };
}
