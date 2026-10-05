// Zod-free and catalog-free, so the extension's content scripts can import it.
import type { MerchantProfileV3 } from './types.ts';

export const GENERIC_MERCHANT_ID = 'generic-us-online';
/** Any U.S. online store the catalog has no profile for. Supplied by the engine, not the catalog, so
 * every v3 release supports it: all-purchases and online-retail rules apply; MCC-group, brand-scoped
 * rules and closed-loop cards do not, and brand exclusions cannot fire (it has no brands). */
export const GENERIC_MERCHANT_PROFILE: MerchantProfileV3 = {
  id: GENERIC_MERCHANT_ID,
  name: 'Another U.S. online store',
  onlineRetail: true,
  physicalGoods: true,
  usMerchant: true,
  expectedCategory: 'general-merchandise',
  mcc: { code: null, confidence: 'low', sourceIds: [] },
  notes: '',
  brandIds: [],
};
