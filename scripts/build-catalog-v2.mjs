// Builds the 7-card catalog v2 deterministically from the verified gold labels, never from model output.
//
//   node scripts/build-catalog-v2.mjs            write packages/rewards-core/src/catalog-v2.ts
//   node scripts/build-catalog-v2.mjs --check    fail if the committed file is stale (CI)
//
// Inputs: the base (non-variant) cases of evals/curation/real/corpus.v2.json, the capture manifest
// (source URLs and dates), and evals/curation/real/merchants.json (merchant profiles and their sources).
// Mapping from gold labels: a null cap becomes `unstated`, a null activation `unstated`, a null
// usMerchantsOnly `false` (no U.S.-only wording); categories map 1:1. Every rule cites all of its card's
// manifest sources. verifiedAt is the latest capture date; the catalog expires 30 days later.
// The version label is that date plus `.real.1` (bump the counter for a rebuild from the same captures).
import { readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { catalogV2Schema } from '../packages/rewards-core/src/schema.ts';

const root = new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const out = new URL('packages/rewards-core/src/catalog-v2.ts', root);

// Display names (issuer first, as in the pilot), short names, and rule-ID prefixes. Prefixes keep the
// pilot's rule IDs for rules that carried over (bce-base, bce-online-retail, quicksilver-base).
const CARDS = {
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
// Amex excludes third-party buy now, pay later from U.S. online retail (BCE terms; research doc).
const EXCLUDED_PAYMENT_PATHS = { 'American Express': { 'online-retail': ['bnpl'] } };

function cap(value, where) {
  if (value === null) return { kind: 'unstated' };
  if (value.kind === 'none') return { kind: 'none' };
  if (value.kind !== 'spend' || !value.amountCents || value.rateAfterCapBps === null)
    throw new Error(`${where}: spend cap needs an amount and an after-cap rate`);
  return {
    kind: 'spend',
    amountCents: value.amountCents,
    period: value.period ?? 'year-unspecified',
    rateAfterCapBps: value.rateAfterCapBps,
  };
}

export function buildCatalog() {
  const corpus = read('evals/curation/real/corpus.v2.json');
  const manifest = read('evals/curation/real/manifest.json');
  const merchants = read('evals/curation/real/merchants.json');
  const bases = corpus.cases.filter((item) => !item.variant);
  const manifestById = new Map(manifest.sources.map((source) => [source.id, source]));
  const usedSourceIds = [...new Set(bases.flatMap((item) => item.sourceIds))];
  const sources = [
    ...manifest.sources
      .filter((source) => usedSourceIds.includes(source.id))
      .map(({ id, title, url, capturedOn }) => ({ id, title, url, checkedOn: capturedOn })),
    ...merchants.sources,
  ];
  for (const id of usedSourceIds) if (!manifestById.has(id)) throw new Error(`Unknown manifest source ${id}`);
  const verifiedOn = manifest.sources
    .map((source) => source.capturedOn)
    .sort()
    .at(-1);
  const verifiedAt = `${verifiedOn}T00:00:00Z`;
  const expiresAt = new Date(Date.parse(verifiedAt) + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('.000', '');

  const cards = bases.map((item) => {
    const meta = CARDS[item.cardId];
    if (!meta) throw new Error(`No display metadata for ${item.cardId}`);
    const reference = item.reference;
    if (reference.issues.length) throw new Error(`${item.cardId}: gold label has open issues`);
    const rules = reference.rules.map((rule) => {
      const where = `${item.cardId}/${rule.category}`;
      if (rule.rateBps === null || rule.paidOnPaymentBps === null) throw new Error(`${where}: rate is null`);
      return {
        id: `${meta.prefix}-${rule.category === 'all-purchases' ? 'base' : rule.category}`,
        category: rule.category,
        issuerWording: rule.issuerWording,
        rateBps: rule.rateBps,
        paidOnPaymentBps: rule.paidOnPaymentBps,
        cap: cap(rule.cap, where),
        activation: rule.activation ?? 'unstated',
        usMerchantsOnly: rule.usMerchantsOnly ?? false,
        excludedPaymentPaths: EXCLUDED_PAYMENT_PATHS[item.issuer]?.[rule.category] ?? [],
        limitedTime: rule.limitedTime === null ? null : { endsOn: rule.limitedTime.endsOn ?? null },
        sourceIds: item.sourceIds,
      };
    });
    // Base first, then bonuses by rate (highest first), keeping the corpus order for ties.
    rules.sort(
      (a, b) =>
        Number(b.category === 'all-purchases') - Number(a.category === 'all-purchases') ||
        b.rateBps - a.rateBps,
    );
    return {
      id: item.cardId,
      name: meta.name,
      shortName: meta.shortName,
      issuer: item.issuer,
      rewardCurrency: reference.rewardCurrency.value,
      pointValueHundredthsOfCent: reference.pointValueHundredthsOfCent.value,
      rules,
      exclusions: reference.exclusions.map((exclusion) => exclusion.text),
    };
  });
  const catalog = {
    schemaVersion: 2,
    version: `${verifiedOn}.real.1`,
    verifiedAt,
    expiresAt,
    merchants: merchants.merchants,
    sources,
    cards,
  };
  return catalogV2Schema.parse(catalog);
}

const catalog = buildCatalog();
const header = `// Generated by scripts/build-catalog-v2.mjs from the verified gold labels in
// evals/curation/real/corpus.v2.json, the capture manifest, and evals/curation/real/merchants.json.
// Do not edit; rerun \`npm run catalog:v2\`.
import type { CatalogV2 } from './types.ts';

/** The 7-card real catalog (schema 2), built from agent-verified labels of issuer pages captured
 * ${catalog.verifiedAt.slice(0, 10)}. Covers ${catalog.merchants.map((m) => m.name).join(', ')}. */
export const CATALOG_V2: CatalogV2 = ${JSON.stringify(catalog, null, 2)};
`;
const text = await format(header, { ...(await resolveConfig(out.pathname)), filepath: out.pathname });
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(out, 'utf8');
  } catch {
    // missing file is stale
  }
  if (current !== text) {
    console.error('packages/rewards-core/src/catalog-v2.ts is stale. Run npm run catalog:v2.');
    process.exit(1);
  }
  console.log(`Catalog v2 ${catalog.version} matches the gold labels (${catalog.cards.length} cards).`);
} else {
  writeFileSync(out, text);
  console.log(`Wrote catalog v2 ${catalog.version} with ${catalog.cards.length} cards.`);
}
