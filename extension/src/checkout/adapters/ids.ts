/** Merchants with a bundled adapter. Adapters ship inside the extension package and are never
 * downloaded (Chrome Web Store remote-code policy). Kept free of zod so the injected content
 * script stays small. */
export const MERCHANT_IDS = ['best-buy-us', 'newegg-us', 'amazon-us'] as const;
export type MerchantId = (typeof MERCHANT_IDS)[number];
export const AMOUNT_KINDS = ['total', 'estimated-total', 'subtotal'] as const;
export type AmountKind = (typeof AMOUNT_KINDS)[number];
