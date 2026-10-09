import { readCart } from '@ai-checkout/cart-reader';
import type { ReadingKind } from '@ai-checkout/cart-reader';
import { GENERIC_READER_VERSION, merchantForCheckout, merchantForTab } from './merchants';
import { readCheckoutPage } from './page-reader';
import type { AmountKind, PageRead } from './page-reader';

/** What the manual reader hands the popup: a legacy adapter read, or a generic read of any other
 * http(s) page (merchant = the store the popup resolves for the tab, usually the generic profile). */
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

/** Phase 13b: the legacy adapter at its three stores (unchanged), `readCart` at any other web page.
 * Returns only the reading (or a reason), never page text. */
export function readManualCart(document: Document, url: string): ManualRead {
  if (merchantForCheckout(url)) return readCheckoutPage(document, url);
  const merchantId = merchantForTab(url);
  if (!merchantId) return { status: 'unavailable', reason: 'unsupported-page' };
  let reading;
  try {
    reading = readCart(document, { url });
  } catch {
    return { status: 'unavailable', reason: 'withheld' };
  }
  if (!reading.shown) return { status: 'unavailable', reason: 'withheld' };
  if (reading.currency !== 'USD') return { status: 'unavailable', reason: 'unsupported-currency' };
  if (reading.amountMinor === 0) return { status: 'unavailable', reason: 'empty-cart' };
  return {
    status: 'found',
    merchantId,
    currency: 'USD',
    amountCents: reading.amountMinor,
    kind: KIND[reading.kind],
    extractorVersion: GENERIC_READER_VERSION,
  };
}
