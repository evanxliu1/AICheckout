import { readCartPage } from '@ai-checkout/cart-reader';
import type { PageKind, ReadingKind } from '@ai-checkout/cart-reader';
import { GENERIC_MERCHANT_ID } from '@ai-checkout/rewards-core/generic-merchant';
import { GENERIC_READER_VERSION, isWebUrl } from './merchants';

export const AMOUNT_KINDS = ['total', 'estimated-total', 'subtotal'] as const;
export type AmountKind = (typeof AMOUNT_KINDS)[number];

/** What a reader hands the popup or the badge: a generic read of any http(s) page, named
 * `generic-us-online`; the worker resolves the tab's store against the merchant release (Phase 14.2,
 * `store-match.ts`) and refuses a reading that names anything else. Since Phase 15.1 the generic reader
 * is the only reader; `summary-missing`, `ambiguous-amount` and `page-loading` are the retired adapters'
 * reasons, still accepted by the contracts and worded in `read-copy.ts`. */
export type ManualRead =
  | {
      status: 'found';
      merchantId: string;
      currency: 'USD';
      amountCents: number;
      kind: AmountKind;
      extractorVersion: typeof GENERIC_READER_VERSION;
    }
  | {
      status: 'unavailable';
      reason:
        | 'unsupported-page'
        | 'empty-cart'
        | 'summary-missing'
        | 'ambiguous-amount'
        | 'unsupported-currency'
        | 'page-loading'
        | 'withheld'
        | 'not-a-cart';
    };

const KIND: Record<ReadingKind, AmountKind> = {
  afterCredit: 'total',
  estimatedTotal: 'estimated-total',
  subtotal: 'subtotal',
};

/** One reader for every URL (Phase 13b, 13c, 15.1): any http(s) page is the generic detector's, then
 * `readCart`'s, in one pass. Returns only the detection and the reading (or a reason), never page text.
 * A page the detector does not recognise as a cart or checkout (`none`) is `not-a-cart`, distinct from a
 * cart whose amount is uncertain (`withheld`), so the popup can stay quiet on it. */
export function readAnyCart(document: Document, url: string): { page: PageKind; reading: ManualRead } {
  if (!isWebUrl(url)) return { page: 'none', reading: { status: 'unavailable', reason: 'unsupported-page' } };
  let page: PageKind, reading;
  try {
    ({
      detection: { page },
      reading,
    } = readCartPage(document, { url }));
  } catch {
    return { page: 'none', reading: { status: 'unavailable', reason: 'withheld' } };
  }
  // An empty cart first (the detector's `zero-total` is `none` too), then any other page that is not a cart.
  if (reading?.shown && reading.amountMinor === 0)
    return { page, reading: { status: 'unavailable', reason: 'empty-cart' } };
  if (page === 'none') return { page, reading: { status: 'unavailable', reason: 'not-a-cart' } };
  if (reading?.shown && reading.currency !== 'USD')
    return { page, reading: { status: 'unavailable', reason: 'unsupported-currency' } };
  if (!reading?.shown) return { page, reading: { status: 'unavailable', reason: 'withheld' } };
  return {
    page,
    reading: {
      status: 'found',
      merchantId: GENERIC_MERCHANT_ID,
      currency: 'USD',
      amountCents: reading.amountMinor,
      kind: KIND[reading.kind],
      extractorVersion: GENERIC_READER_VERSION,
    },
  };
}

/** The popup's manual read: the reading of `readAnyCart`. */
export function readManualCart(document: Document, url: string): ManualRead {
  return readAnyCart(document, url).reading;
}
