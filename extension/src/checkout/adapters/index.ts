import { siteAdapterSchema, type MerchantId, type SiteAdapter } from './schema';
import bestBuy from './best-buy-us.json' with { type: 'json' };
import newegg from './newegg-us.json' with { type: 'json' };
import amazon from './amazon-us.json' with { type: 'json' };

export * from './schema';

/** Bundled adapters, validated when the module loads (and at build time by vite.config.ts). */
export const SITE_ADAPTERS: Record<MerchantId, SiteAdapter> = {
  'best-buy-us': siteAdapterSchema.parse(bestBuy),
  'newegg-us': siteAdapterSchema.parse(newegg),
  'amazon-us': siteAdapterSchema.parse(amazon),
};
for (const [id, adapter] of Object.entries(SITE_ADAPTERS))
  if (adapter.merchantId !== id) throw new Error(`Adapter ${id} declares ${adapter.merchantId}`);
