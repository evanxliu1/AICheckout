// Legacy reader mode: the extension's three bundled store adapters (Amazon, Best Buy, Newegg; extension/src/checkout)
// behind the generic reader's interface, so the harness can score them apart on their own stores' pages
// (protocol, Scoring: Legacy adapters). `matches(url)` is the adapters' own checkout-URL rule. Mapping: `total` and
// `estimated-total` are estimatedTotal (the adapters never read a credit row), `subtotal` is subtotal, amounts are
// USD cents; every unavailable reason withholds.
import { merchantForCheckout } from '../../extension/src/checkout/merchants';
import { readCheckoutPage } from '../../extension/src/checkout/page-reader';

type Reading =
  | { shown: true; kind: 'estimatedTotal' | 'subtotal'; amountMinor: number; currency: 'USD' }
  | { shown: false; reason: string };

export function matches(url: string): boolean {
  return merchantForCheckout(url) !== null;
}

export function readCart(document: Document, options: { url: string }): Reading {
  const r = readCheckoutPage(document, options.url);
  if (r.status !== 'found') return { shown: false, reason: r.reason };
  return {
    shown: true,
    kind: r.kind === 'subtotal' ? 'subtotal' : 'estimatedTotal',
    amountMinor: r.amountCents,
    currency: 'USD',
  };
}
