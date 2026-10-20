/** Messages for a manual cart read that did not produce an amount, by reason. Shared by the worker's
 * reader (browser.ts) and the popup, which recognises the reasons that get the rates view. None asks
 * for a typed amount (decision 2026-10-09; A5 of the 2026-10-10 audit); the amount field stays optional. */
export const READ_COPY = {
  'unsupported-page': 'Open a store’s cart or checkout page in a web tab, then read it again.',
  'empty-cart': 'This cart is empty, so there is no amount to compare. Add an item, then read it again.',
  'unsupported-currency': 'This comparison supports USD only. The cart showed another currency.',
  withheld: 'The cart total could not be read with certainty on this page. Your cards are compared by rate.',
  /** The detector did not recognise a cart or checkout page (Phase 13c review fix): the popup's read on open
   * says nothing; the button shows this. */
  'not-a-cart':
    'This page doesn’t look like a cart or checkout page. Open the store’s cart, then read it again.',
  /** A payment processor's page (Phase 14.2): the store is not known there, so nothing is read or compared. */
  'payment-page':
    'This is a payment page, not the store’s. Cards can’t be compared here; open the store’s cart or checkout page, or pick the store below.',
} as const;
/** The read found a cart or checkout page but not a certain amount: the popup compares by rate. */
export const RATES_READ_MESSAGES: string[] = [READ_COPY.withheld];
