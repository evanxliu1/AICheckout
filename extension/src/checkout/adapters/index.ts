import type { SiteAdapter } from './schema';
import type { MerchantId } from './ids';
import bestBuy from './best-buy-us.json' with { type: 'json' };
import newegg from './newegg-us.json' with { type: 'json' };
import amazon from './amazon-us.json' with { type: 'json' };

export * from './ids';
export type { SiteAdapter } from './schema';

/** Bundled adapter specs. They are validated against siteAdapterSchema at build time
 * (vite.config.ts) and in tests, not at runtime, so zod never ships in the content script. */
export const SITE_ADAPTERS = {
  'best-buy-us': bestBuy,
  'newegg-us': newegg,
  'amazon-us': amazon,
} as Record<MerchantId, SiteAdapter>;
