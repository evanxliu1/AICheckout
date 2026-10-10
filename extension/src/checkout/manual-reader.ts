import { readCartPage } from '@ai-checkout/cart-reader';
import type { PageKind, ReadingKind } from '@ai-checkout/cart-reader';
import { GENERIC_READER_VERSION, merchantForCheckout, merchantForTab } from './merchants';
import { readCheckoutPage } from './page-reader';
import type { AmountKind, PageRead } from './page-reader';

/** What a reader hands the popup or the badge: a legacy adapter read, or a generic read of any other
 * http(s) page (merchant = the store resolved for the tab, usually the generic profile). */
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
  | { status: 'unavailable'; reason: 'withheld' };

const KIND: Record<ReadingKind, AmountKind> = {
  afterCredit: 'total',
  estimatedTotal: 'estimated-total',
  subtotal: 'subtotal',
};

/** One reader per URL (Phase 13b, 13c): a URL a legacy adapter matches is that adapter's, unchanged
 * (`page: 'legacy'`); any other http(s) page is the generic detector's, then `readCart`'s, in one pass.
 * Returns only the detection and the reading (or a reason), never page text. A page the detector
 * does not recognise as a cart or checkout (`none`) withholds. */
export function readAnyCart(
  document: Document,
  url: string,
): { page: PageKind | 'legacy'; reading: ManualRead } {
  if (merchantForCheckout(url)) return { page: 'legacy', reading: readCheckoutPage(document, url) };
  const merchantId = merchantForTab(url);
  if (!merchantId) return { page: 'none', reading: { status: 'unavailable', reason: 'unsupported-page' } };
  let page: PageKind, reading;
  try {
    ({
      detection: { page },
      reading,
    } = readCartPage(document, { url }));
  } catch {
    return { page: 'none', reading: { status: 'unavailable', reason: 'withheld' } };
  }
  if (reading?.shown && reading.currency !== 'USD')
    return { page, reading: { status: 'unavailable', reason: 'unsupported-currency' } };
  if (reading?.shown && reading.amountMinor === 0)
    return { page, reading: { status: 'unavailable', reason: 'empty-cart' } };
  if (page === 'none' || !reading?.shown)
    return { page, reading: { status: 'unavailable', reason: 'withheld' } };
  return {
    page,
    reading: {
      status: 'found',
      merchantId,
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
