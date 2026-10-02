// Consolidate the issuer research drafts into the card list and capture sources for the catalog expansion.
//
//   node scripts/build-expansion-cards.mjs
//
// Reads docs/research/cards-2026/*.json (agent research drafts; values are unverified) and writes:
//   evals/curation/expansion/cards.json       cards to capture, extract, and label
//   evals/curation/expansion/exclusions.json  cards left out, with the reason
//   evals/curation/expansion/sources.json     official pages to capture (same format as real/sources.json)
//
// Nothing from the research goes into the catalog: it only chooses which cards and pages to capture. Rates
// come later from the captures (LLM extraction, then independent verification).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const researchDir = join(root, 'docs/research/cards-2026');
const outDir = join(root, 'evals/curation/expansion');

/** Cards already labeled in evals/curation/real. */
const ALREADY_LABELED = new Set([
  'citi-double-cash',
  'wells-fargo-active-cash',
  'capital-one-quicksilver',
  'capital-one-savor',
  'chase-freedom-unlimited',
  'amex-blue-cash-everyday',
  'amex-blue-cash-preferred',
]);

/** Cards whose research says they earn no purchase rewards. */
const NO_REWARDS = {
  'wells-fargo-reflect': 'No rewards program (balance-transfer / intro-APR card).',
  'capital-one-platinum': 'Credit-building card with no rewards.',
  'capital-one-platinum-secured': 'Secured credit-building card with no rewards.',
  'us-bank-secured-visa': 'Secured credit-building card with no rewards.',
  'citi-secured-mastercard': 'Secured card; no rewards advertised.',
  'chase-slate-edge': 'Credit-building card with no purchase rewards.',
  'us-bank-edward-jones-flex-balance':
    'Research found no official page and no rewards (annual statement credit only).',
};

/** "for Good Credit" variants: same earn rates as the main card, no welcome bonus. Merged into the main card. */
const MERGED_VARIANTS = {
  'capital-one-quicksilver-good-credit': 'capital-one-quicksilver',
  'capital-one-savor-good-credit': 'capital-one-savor',
  'capital-one-ventureone-good-credit': 'capital-one-ventureone',
};

/** Discover cards that the Capital One research also listed (Capital One owns Discover); kept under Discover. */
const DISCOVER_IN_CAPITAL_ONE = new Set([
  'discover-it-cash-back',
  'discover-it-secured-cash-back',
  'discover-it-chrome',
  'discover-it-miles',
]);

/** Pages never captured: generic catalogs that list many cards, apply flows, calculators, benefit guides. */
const SKIP_URL = [
  /^https:\/\/www\.capitalone\.com\/credit-cards\/$/,
  /capitalone\.com\/apply\//,
  /rewards-disclosure-terms-and-conditions/,
  /global\.americanexpress\.com\/rewards\/calculator/,
  /citiretailservices\.citibankonline\.com\/apply\/best-buy/,
  /online\.citi\.com\/US\/nga\/cards\/displayterms/,
  /onboarding\.usbank\.com\/gateway/,
  /discover\.com\/credit-cards\/cash-back\/cashback-bonus\.html/,
  /discover\.com\/credit-cards\/cashback-bonus\/cashback-calendar\.html/,
  /discover\.com\/content\/dam\/.*Ts_Cs_Discover_It_SM\.pdf/,
  /discover\.com\/credit-cards\/card-smarts\//,
  /citi\.com\/credit-cards\/citi-strata-all-cards/,
  /trueblue\.jetblue\.com/,
  /mastercard\.us\/synchronyWorldGTB/,
  /mycardgtb\.com/,
  /wellsfargo\.com\/rewards\/$/,
  /usbank\.com\/cpi$/,
  /usbank\.com\/customer-service\/knowledge-base/,
  /contenthub\/newsroom/,
  /synchrony\.com\/partner\/american-eagle\/mobile-wallet/,
  /synchrony\.com\/partner\/synchrony-mastercards/,
  /h-dvisa\.com\/$/,
  /info\.bankofamerica\.com\/en\/rewards\/bofa-rewards/,
  // An HTML application shell, not the terms PDF its name suggests.
  /citiretailservices\.citibankonline\.com\/apply\/tncFetchPdf/,
  // Returned an error page during research and in the pilot capture (2026-10-01).
  /wellsfargo\.com\/credit-cards\/terms\/onekey/,
  /bankofamerica\.com\/credit-cards\/premium-benefits/,
];
const SKIP_KINDS = new Set(['benefits-guide-pdf']);

/** Extra official pages (issuer domains) not in the research URL lists. */
const EXTRA_URLS = {
  // Capital One's own disclosure pages for the Discover cards it now issues.
  'discover-it-cash-back': [
    { url: 'https://disclosures.capitalone.com/disclosure.41564.en-US.html', kind: 'application-terms' },
  ],
  'discover-it-secured-cash-back': [
    { url: 'https://disclosures.capitalone.com/disclosure.41586.en-US.html', kind: 'application-terms' },
    {
      url: 'https://www.discover.com/credit-cards/cash-back/cashback-calendar.html',
      kind: 'rotating-calendar',
    },
  ],
  'discover-it-chrome': [
    { url: 'https://disclosures.capitalone.com/disclosure.41577.en-US.html', kind: 'application-terms' },
  ],
  'discover-it-miles': [
    { url: 'https://disclosures.capitalone.com/disclosure.41597.en-US.html', kind: 'application-terms' },
  ],
};

/** Order of preference when a card has more pages than MAX_SOURCES. */
const KIND_RANK = {
  'product-page': 0,
  'rewards-terms': 1,
  'application-terms': 1,
  'rates-and-fees': 2,
  'rotating-calendar': 3,
  'category-faq': 4,
  'partner-page': 4,
};
const MAX_SOURCES = 3;
/** Per-card page choices where the generic ranking picks the wrong pages. */
const PICK = {
  // Chase: product page, the card's rewards agreement where one exists, and the shared category FAQ for cards
  // with bonus categories; pricing pages are mostly APRs.
  'chase-freedom-flex': [
    'creditcards.chase.com/cash-back-credit-cards/freedom/flex',
    'chase.com/freedomflex/rewardsagreement',
    'chase.com/rewardscategoryfaqs',
  ],
  'chase-sapphire-preferred': [
    'creditcards.chase.com/rewards-credit-cards/sapphire/preferred',
    'RPA0551_0560_Web.pdf',
    'chase.com/rewardscategoryfaqs',
  ],
  'prime-visa': ['amazon-prime-rewards', 'chase.com/amazon/rewardsagreement', 'LGC59329'],
  'disney-premier-visa': ['disney/premier', 'disneyrewardsterms', 'LGC63172'],
  'boa-customized-cash-rewards': [
    'cash-back-credit-card/$',
    'productoffercode=8H',
    'cash-back-category-choices',
  ],
  'us-bank-cash-plus': ['cash-plus-visa-signature', 'CashPlusBenefits/faqs', 'samplemerchants'],
  'wells-fargo-autograph': ['autograph-visa-credit-card', 'autograph-visa/terms', 'autograph-visa/streaming'],
  'citi-costco-anywhere-visa': [
    'costco-anywhere-visa-card$',
    'costco-anywhere-visa-card/additional',
    'Costco_Exclusions',
  ],
};

/** Shared pages get one ID. */
const SHARED_IDS = {
  'https://www.chase.com/rewardscategoryfaqs': ['chase-rewards-category-faq', 'Chase Rewards Category FAQ'],
  'https://www.bankofamerica.com/credit-cards/products/cash-back-credit-card/cash-back-category-choices/': [
    'boa-cash-back-category-choices',
    'Bank of America Customized Cash Rewards: Category Choices',
  ],
  'https://cashplus.usbank.com/cash-plus/samplemerchants': [
    'us-bank-cash-plus-sample-merchants',
    'U.S. Bank Cash+ Categories and Sample Merchants',
  ],
  'https://www.discover.com/credit-cards/cash-back/cashback-calendar.html': [
    'discover-cashback-calendar',
    'Discover 5% Cashback Calendar',
  ],
  'https://www.amazon.com/Synchrony-Bank-Amazon-com-Store-Card/dp/B008A0GNA8': [
    'amazon-store-card-product',
    'Amazon Store Card and Amazon Secured Card',
  ],
  'https://www.statefarm.com/finances/banking/credit-cards': [
    'state-farm-credit-cards',
    'State Farm Credit Cards',
  ],
  'https://www.skypassvisa.com/credit/welcome.do': ['skypass-visa-cards', 'SKYPASS Visa Cards'],
  'https://onboarding.usbank.com/gateway/partner/credit-card/begin?locationCode=8924&mktChl=DFT&offerId=WDW7HPBPR1&sourceCode=87676&page=terms':
    ['harley-davidson-visa-terms', 'Harley-Davidson Visa Terms'],
};

const KIND_SUFFIX = {
  'product-page': 'product',
  'rewards-terms': 'rewards-terms',
  'application-terms': 'terms',
  'rates-and-fees': 'pricing',
  'rotating-calendar': 'calendar',
  'category-faq': 'categories',
  'partner-page': 'partner',
};
const KIND_TITLE = {
  'product-page': '',
  'rewards-terms': ': Rewards Terms',
  'application-terms': ': Application Terms',
  'rates-and-fees': ': Pricing and Terms',
  'rotating-calendar': ': Rotating Category Calendar',
  'category-faq': ': Category Information',
  'partner-page': ': Synchrony Partner Page',
};

/** Ongoing annual fee in dollars when the research states it plainly; otherwise null with the text kept. */
function annualFee(text) {
  const plain = /^\$([\d,]+)$/.exec(text.trim());
  if (plain) return { annualFeeUsd: Number(plain[1].replace(/,/g, '')), annualFeeNote: null };
  const then = /then \$([\d,]+)/.exec(text);
  if (then) return { annualFeeUsd: Number(then[1].replace(/,/g, '')), annualFeeNote: text };
  const lead = /^\$([\d,]+)\b(?!\s*-)/.exec(text.trim());
  if (lead) return { annualFeeUsd: Number(lead[1].replace(/,/g, '')), annualFeeNote: text };
  return { annualFeeUsd: null, annualFeeNote: text };
}

/** Research URLs that need a correction to load: Barclays terms take a `tc` prefix on the offer number. */
const fixUrl = (url) => url.replace(/(barclaycardus\.com\/applycontent\/TnCs\.jsp\?)(\d+)$/, '$1tc$2');

const cleanName = (name) => name.replace(/[®™℠]/g, '').replace(/\s+/g, ' ').trim();

const files = readdirSync(researchDir)
  .filter((name) => name.endsWith('.json'))
  .sort();
const research = files.map((name) => ({
  file: `docs/research/cards-2026/${name}`,
  ...JSON.parse(readFileSync(join(researchDir, name), 'utf8')),
}));

const cards = [];
const exclusions = [];
const byId = new Map();
const extraUrls = new Map(Object.entries(EXTRA_URLS).map(([id, urls]) => [id, [...urls]]));
const mergedNotes = new Map();

for (const issuer of research) {
  for (const card of issuer.cards) {
    const exclude = (reason, extra = {}) =>
      exclusions.push({
        id: card.id,
        name: cleanName(card.name),
        issuer: issuer.issuer,
        reason,
        research: issuer.file,
        ...extra,
      });
    if (issuer.issuer === 'Capital One' && DISCOVER_IN_CAPITAL_ONE.has(card.id)) {
      exclude(
        'Duplicate: a Discover card (Capital One owns Discover). Kept under Discover; its Capital One disclosure page is added as a source.',
        { mergedInto: card.id },
      );
      continue;
    }
    if (ALREADY_LABELED.has(card.id)) {
      exclude('Already labeled in evals/curation/real (7-card corpus).');
      continue;
    }
    if (MERGED_VARIANTS[card.id]) {
      const target = MERGED_VARIANTS[card.id];
      const where = ALREADY_LABELED.has(target)
        ? ' (the main card is already labeled in evals/curation/real)'
        : '';
      exclude(
        `Merged into ${target}: a "for Good Credit" variant with the same earn rates and no welcome bonus${where}.`,
        { mergedInto: target },
      );
      mergedNotes.set(
        target,
        `${cleanName(card.name)} (${card.id}) merged here: same earn rates, no welcome bonus.`,
      );
      continue;
    }
    if (NO_REWARDS[card.id]) {
      exclude(`Earns no rewards: ${NO_REWARDS[card.id]}`);
      continue;
    }
    if (card.openToNewApplicants === false) {
      exclude('Closed to new applicants.');
      continue;
    }
    if (/business/i.test(card.group) || /\bbusiness\b/i.test(card.name)) {
      exclude('Business card.');
      continue;
    }
    const fee = annualFee(card.annualFee ?? '');
    const entry = {
      id: card.id,
      name: cleanName(card.name),
      issuer: issuer.issuer,
      group: card.group,
      coBrandPartner: card.coBrandPartner ?? null,
      closedLoop: card.closedLoop === true,
      network: card.network ?? null,
      ...fee,
      rewardCurrency: card.rewardCurrency,
      urls: [],
      notes: [],
      research: issuer.file,
    };
    for (const official of card.officialUrls ?? [])
      entry.urls.push({ url: fixUrl(official.url), kind: official.kind });
    for (const extra of extraUrls.get(card.id) ?? []) entry.urls.push(extra);
    cards.push(entry);
    byId.set(card.id, entry);
  }
  for (const closed of issuer.closedButCommon ?? [])
    exclusions.push({
      id: null,
      name: cleanName(closed.name),
      issuer: issuer.issuer,
      reason: `Closed to new applicants (or not offered): ${closed.note}`,
      research: issuer.file,
    });
}
for (const [target, note] of mergedNotes) byId.get(target)?.notes.push(note);

// Notes the consolidation adds on top of the research.
const NOTES = {
  'us-bank-shield':
    'Rewards only on prepaid travel booked through the U.S. Bank travel center; no base earn rate stated in the research. Kept because it earns some rewards.',
  'discover-it-student-chrome':
    'Capital One research says this card may no longer take applications; Discover research says it is open. Check the captured page.',
  'discover-it-student-cash-back':
    'Capital One research says this card is not in its product API; Discover research says it is open. Check the captured page.',
  'discover-it-secured-cash-back':
    'Relaunched in 2026 with rotating 5% categories; the old 2% gas/restaurants version is closed.',
  'synchrony-amazon-secured-card':
    'Secured version of the Amazon Store Card, described on the same Amazon page; separate product.',
  'capital-one-union-plus-cash-rewards': 'Affinity card for union members.',
  'capital-one-teamster-privilege-cash-rewards': 'Affinity card for Teamsters members.',
};
for (const [id, note] of Object.entries(NOTES)) byId.get(id)?.notes.push(note);

// ---- Sources --------------------------------------------------------------------------------------------
const sources = new Map();
const pickIndex = (card, urls) => {
  const pick = PICK[card.id];
  if (!pick) return null;
  return pick.map((needle) => {
    const re = new RegExp(needle.replace(/[.?]/g, (c) => `\\${c}`));
    const found = urls.find((u) => re.test(u.url));
    if (!found) throw new Error(`${card.id}: pick ${needle} matches no URL`);
    return found;
  });
};
for (const card of cards) {
  const candidates = card.urls.filter(
    (u, i, all) =>
      !SKIP_KINDS.has(u.kind) &&
      !SKIP_URL.some((re) => re.test(u.url)) &&
      all.findIndex((other) => other.url === u.url) === i,
  );
  const chosen =
    pickIndex(card, candidates) ??
    [...candidates]
      .map((u, i) => ({ u, i }))
      .sort((a, b) => (KIND_RANK[a.u.kind] ?? 9) - (KIND_RANK[b.u.kind] ?? 9) || a.i - b.i)
      .slice(0, MAX_SOURCES)
      .map(({ u }) => u);
  card.sourceIds = [];
  const used = new Set();
  for (const { url, kind } of chosen) {
    const normalizedKind = /synchrony\.com\/partner\//.test(url)
      ? 'partner-page'
      : KIND_SUFFIX[kind]
        ? kind
        : 'category-faq';
    let id, title;
    if (SHARED_IDS[url]) [id, title] = SHARED_IDS[url];
    else {
      let suffix = KIND_SUFFIX[normalizedKind];
      if (used.has(suffix)) suffix = `${suffix}-2`;
      used.add(suffix);
      id = `${card.id}-${suffix}`;
      title = `${card.name}${KIND_TITLE[normalizedKind]}`;
    }
    const existing = [...sources.values()].find((s) => s.url === url);
    if (existing) {
      if (!existing.cardIds.includes(card.id)) existing.cardIds.push(card.id);
      card.sourceIds.push(existing.id);
      continue;
    }
    if (sources.has(id)) throw new Error(`Duplicate source id ${id}`);
    sources.set(id, {
      id,
      cardIds: [card.id],
      issuer: card.issuer,
      kind: normalizedKind,
      title: title.slice(0, 200),
      url,
    });
    card.sourceIds.push(id);
  }
  if (!card.sourceIds.length) card.notes.push('No official page to capture.');
}

const out = (name, value) => writeFileSync(join(outDir, name), JSON.stringify(value, null, 2) + '\n');
out('cards.json', {
  schemaVersion: 1,
  generatedBy: 'scripts/build-expansion-cards.mjs',
  description:
    'Cards for the catalog expansion, consolidated from the research drafts in docs/research/cards-2026 (unverified). Fields other than id, issuer, group, and sources are research hints; rates come from the captures.',
  cards: cards.map(({ urls: _urls, ...card }) => card),
});
out('exclusions.json', {
  schemaVersion: 1,
  generatedBy: 'scripts/build-expansion-cards.mjs',
  exclusions,
});
out('sources.json', { schemaVersion: 1, sources: [...sources.values()] });
// Capture hints (scripts/capture-issuer-pages.mjs --hints): synchrony.com blocks headless Chromium but serves
// static HTML; U.S. Bank rewards FAQs keep answers collapsed behind "Expand All".
const hints = {};
for (const source of sources.values()) {
  if (/^https:\/\/www\.synchrony\.com\//.test(source.url)) hints[source.id] = { request: true };
  if (/rewards\.usbank\.com\/benefits\/card\/.*\/faqs/.test(source.url))
    hints[source.id] = { click: ['Expand All'] };
}
out('capture-hints.json', hints);
const count = (list, key) => list.reduce((acc, x) => ((acc[x[key]] = (acc[x[key]] ?? 0) + 1), acc), {});
console.log('included', cards.length, count(cards, 'issuer'));
console.log('excluded', exclusions.length, count(exclusions, 'issuer'));
console.log('sources', sources.size);
