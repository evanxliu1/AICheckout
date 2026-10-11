import { readCartPage } from '@ai-checkout/cart-reader';
import type { PageKind, ReadingKind } from '@ai-checkout/cart-reader';
import { GENERIC_MERCHANT_ID } from '@ai-checkout/rewards-core/generic-merchant';
import { GENERIC_READER_VERSION, isWebUrl, merchantForCheckout } from './merchants';
import { readCheckoutPage } from './page-reader';
import type { AmountKind, PageRead } from './page-reader';

/** What a reader hands the popup or the badge: a legacy adapter read, or a generic read of any other
 * http(s) page, named `generic-us-online`; the worker resolves the tab's store against the merchant
 * release (Phase 14.2, `store-match.ts`) and refuses a reading that names anything else. */
export type ManualRead =
  | PageRead
  | {
      status: 'found';
      merchantId: string;
      currency: 'USD';
      amountCents: number;
      kind: AmountKind;
      extractorVersion: typeof GENERIC_READER_VERSION;
    }
  | { status: 'unavailable'; reason: 'withheld' | 'not-a-cart' };

const KIND: Record<ReadingKind, AmountKind> = {
  afterCredit: 'total',
  estimatedTotal: 'estimated-total',
  subtotal: 'subtotal',
};

/** One reader per URL (Phase 13b, 13c): a URL a legacy adapter matches is that adapter's, unchanged
 * (`page: 'legacy'`); any other http(s) page is the generic detector's, then `readCart`'s, in one pass.
 * Returns only the detection and the reading (or a reason), never page text. A page the detector
 * does not recognise as a cart or checkout (`none`) is `not-a-cart`, distinct from a cart whose amount
 * is uncertain (`withheld`), so the popup can stay quiet on it. */
export function readAnyCart(
  document: Document,
  url: string,
): { page: PageKind | 'legacy'; reading: ManualRead } {
  if (merchantForCheckout(url)) return { page: 'legacy', reading: readCheckoutPage(document, url) };
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
