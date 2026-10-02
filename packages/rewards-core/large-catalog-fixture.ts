// A synthetic catalog v3 the size of the Stage 2 release (180 cards, 340 sources), for the review
// app's component tests, the API's size limits, the axe gate and the local-stack browser test
// (Stage 2 M8). Test data only: no issuer terms. Type-only imports, so Node strips the types and
// `.mjs` scripts and specs can import it, like test-cases.ts.
import type { CardProductV3, CatalogV3, RewardRuleV3, Source } from './src/types.ts';

const pad = (n: number, width = 3) => String(n).padStart(width, '0');
const DAY_MS = 86_400_000;

function rule(id: string, sourceIds: string[], overrides: Partial<RewardRuleV3> = {}): RewardRuleV3 {
  return {
    id,
    category: 'all-purchases',
    issuerWording: `Synthetic wording for ${id}, written for a size test of the review app`,
    rateBps: 100,
    paidOnPaymentBps: 0,
    cap: { kind: 'none' },
    activation: 'none',
    usMerchantsOnly: false,
    excludedPaymentPaths: [],
    limitedTime: null,
    sourceIds,
    brandIds: [],
    excludedBrandIds: [],
    sharedCapId: null,
    choice: null,
    requires: [],
    requiredPaymentPaths: [],
    ...overrides,
  };
}

/** Card names are "Synthetic Card 001" … with issuers "Synthetic Bank 01" … for search tests. */
export function largeCatalogV3({
  cards: cardCount = 180,
  sources: sourceCount = 340,
  day = new Date().toISOString().slice(0, 10),
}: { cards?: number; sources?: number; day?: string } = {}): CatalogV3 {
  const verifiedAt = `${day}T00:00:00Z`;
  const expiresAt = new Date(Date.parse(verifiedAt) + 29 * DAY_MS).toISOString().replace('.000', '');
  const sources: Source[] = Array.from({ length: sourceCount }, (_, i) => ({
    id: `large-source-${pad(i + 1)}`,
    title: `Synthetic terms ${pad(i + 1)} for the large review test`,
    url: `https://issuer.example/large/${pad(i + 1)}`,
    checkedOn: day,
  }));
  const brands = Array.from({ length: 60 }, (_, i) => ({
    id: `brand-${pad(i + 1, 2)}`,
    name: `Synthetic Brand ${pad(i + 1, 2)}`,
  }));
  const programs: CatalogV3['programs'] = [
    {
      id: 'cash-back',
      name: 'Cash back',
      currency: 'cash-back',
      unitName: 'cents',
      valuation: { basis: 'cash', valueHundredthsOfCent: 100 },
      redemptionBrandIds: [],
    },
    ...Array.from({ length: 30 }, (_, i): CatalogV3['programs'][number] => ({
      id: `points-${pad(i + 1, 2)}`,
      name: `Synthetic Points ${pad(i + 1, 2)}`,
      currency: 'points',
      unitName: i % 2 ? 'miles' : 'points',
      valuation:
        i % 3 === 0
          ? {
              basis: 'published-estimate',
              valueHundredthsOfCent: 100 + i,
              publisher: 'Example Valuations',
              url: `https://valuations.example/points-${pad(i + 1, 2)}`,
              retrievedOn: day,
            }
          : i % 3 === 1
            ? { basis: 'issuer-stated', valueHundredthsOfCent: 100, sourceIds: [sources[i].id] }
            : { basis: 'none' },
      redemptionBrandIds: i % 5 === 0 ? [brands[i].id] : [],
    })),
  ];
  const gates: CatalogV3['gates'] = Array.from({ length: 10 }, (_, i) => ({
    id: `gate-${pad(i + 1, 2)}`,
    question: `Do you hold synthetic membership ${pad(i + 1, 2)}?`,
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
  }));
  const merchants: CatalogV3['merchants'] = [
    ['amazon-us', 'Amazon', 'general-merchandise', 'brand-01'],
    ['best-buy-us', 'Best Buy', 'electronics', 'brand-02'],
    ['newegg-us', 'Newegg', 'electronics', 'brand-03'],
  ].map(([id, name, expectedCategory, brand]) => ({
    id,
    name,
    onlineRetail: true,
    physicalGoods: true,
    usMerchant: true,
    expectedCategory: expectedCategory as CatalogV3['merchants'][number]['expectedCategory'],
    mcc: { code: null, confidence: 'low', sourceIds: [] },
    notes: 'Synthetic merchant for the large review test.',
    brandIds: [brand],
  }));
  const cards = Array.from({ length: cardCount }, (_, i): CardProductV3 => {
    const n = pad(i + 1);
    const cited = [sources[(2 * i) % sourceCount].id, sources[(2 * i + 1) % sourceCount].id];
    const closed = i % 20 === 19;
    const brand = brands[i % brands.length].id,
      other = brands[(i + 7) % brands.length].id;
    const quarterCap = {
      kind: 'spend',
      amountCents: 150_000,
      period: 'quarter',
      rateAfterCapBps: 100,
    } as const;
    const rules: RewardRuleV3[] = [
      ...(closed ? [] : [rule(`c${n}-base`, cited)]),
      rule(`c${n}-brand`, cited, {
        category: 'other',
        rateBps: 500,
        brandIds: [brand],
        requires: [{ gateId: gates[i % gates.length].id, optionIds: ['yes'] }],
      }),
      rule(`c${n}-choice-a`, cited, {
        category: 'electronics',
        rateBps: 300,
        cap: quarterCap,
        activation: 'recurring',
        choice: { choiceId: 'pick', optionId: 'electronics' },
        sharedCapId: `c${n}-shared`,
      }),
      rule(`c${n}-choice-b`, cited, {
        category: 'department-stores',
        rateBps: 300,
        cap: quarterCap,
        activation: 'recurring',
        choice: { choiceId: 'pick', optionId: 'department-stores' },
        sharedCapId: `c${n}-shared`,
      }),
      rule(`c${n}-rotating`, cited, {
        category: 'supermarkets',
        rateBps: 500,
        cap: quarterCap,
        activation: 'recurring',
        limitedTime: { startsOn: day, endsOn: expiresAt.slice(0, 10) },
        excludedBrandIds: [other],
      }),
      rule(`c${n}-paypal`, cited, {
        category: 'online-retail',
        rateBps: 200,
        requiredPaymentPaths: ['paypal'],
      }),
      rule(`c${n}-dining`, cited, { category: 'dining', rateBps: 300, excludedPaymentPaths: ['bnpl'] }),
    ];
    const program = programs[i % programs.length];
    return {
      id: `synthetic-card-${n}`,
      name: `Synthetic Card ${n}`,
      shortName: `Card ${n}`,
      issuer: `Synthetic Bank ${pad((i % 12) + 1, 2)}`,
      programId: program.id,
      statedValueHundredthsOfCent: program.currency === 'points' && i % 7 === 0 ? 125 : null,
      acceptance: closed ? { kind: 'closed-loop', brandIds: [brand] } : { kind: 'open-loop' },
      choices: [
        {
          id: 'pick',
          kind: 'chosen',
          label: 'One 3% category, chosen each quarter',
          picks: 1,
          options: [
            { id: 'electronics', label: 'Electronics stores' },
            { id: 'department-stores', label: 'Department stores' },
          ],
          defaultOptionIds: ['electronics'],
        },
      ],
      rules,
      exclusions: ['Balance transfers and cash advances'],
    };
  });
  return {
    schemaVersion: 3,
    version: `${day}.large-test.1`,
    verifiedAt,
    expiresAt,
    programs,
    brands,
    gates,
    merchants,
    sources,
    cards,
  };
}
