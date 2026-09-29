import type { Catalog } from './types.ts';

/** Reviewed engineering seed, scoped to Best Buy US and Newegg US. Not a complete benefits catalog.
 * The 30-day refresh deadline is our product policy, not an issuer effective/end date. */
export const PILOT_CATALOG: Catalog = {
  schemaVersion: 1,
  version: '2026-09-25.pilot.2',
  verifiedAt: '2026-09-25T00:00:00Z',
  expiresAt: '2026-10-25T00:00:00Z',
  merchantIds: ['best-buy-us', 'newegg-us'],
  sources: [
    {
      id: 'capital-one-quicksilver-benefits',
      title: 'Capital One Quicksilver benefits',
      url: 'https://www.capitalone.com/learn-grow/money-management/quicksilver-card-benefits/',
      checkedOn: '2026-09-25',
    },
    {
      id: 'amex-bce-rewards',
      title: 'American Express Blue Cash Everyday rewards terms',
      url: 'https://global.americanexpress.com/card-benefits/terms/blue-cash-everyday',
      checkedOn: '2026-09-25',
    },
    {
      id: 'amex-online-retail',
      title: 'American Express online retail category guidance',
      url: 'https://www.americanexpress.com/us/rewards-info/retail.htm',
      checkedOn: '2026-09-25',
    },
  ],
  cards: [
    {
      id: 'capital-one-quicksilver',
      name: 'Capital One Quicksilver',
      shortName: 'Quicksilver',
      rules: [
        {
          id: 'quicksilver-base',
          category: 'all-eligible',
          rateBps: 150,
          requiresActivation: false,
          sourceIds: ['capital-one-quicksilver-benefits'],
        },
      ],
    },
    {
      id: 'amex-blue-cash-everyday',
      name: 'American Express Blue Cash Everyday',
      shortName: 'Blue Cash Everyday',
      rules: [
        {
          id: 'bce-base',
          category: 'all-eligible',
          rateBps: 100,
          requiresActivation: false,
          sourceIds: ['amex-bce-rewards'],
        },
        {
          id: 'bce-online-retail',
          category: 'us-online-retail',
          rateBps: 300,
          annualCapCents: 600_000,
          requiresActivation: false,
          sourceIds: ['amex-bce-rewards', 'amex-online-retail'],
        },
      ],
    },
  ],
};
