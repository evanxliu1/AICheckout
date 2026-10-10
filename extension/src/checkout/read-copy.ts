/** Messages for a manual cart read that did not produce an amount, by reason. Shared by the worker's
 * reader (browser.ts) and the popup, which recognises the reasons that get the rates view. */
export const READ_COPY = {
  'unsupported-page':
    'Open a store’s cart or checkout page in a web tab, then read it again. You can also enter the amount manually.',
  'empty-cart': 'The cart has no amount to compare. Add an item or enter a purchase amount manually.',
  'summary-missing':
    'No readable order summary was found. Wait for the cart to load, retry, or enter the amount manually.',
  'ambiguous-amount':
    'The page shows an ambiguous amount. Enter and confirm the amount you will charge manually.',
  'unsupported-currency': 'This comparison supports USD only. The cart showed another currency.',
  'page-loading': 'The order summary is still loading. Wait for it to finish, then read it again.',
  withheld: 'The cart total could not be read with certainty on this page. Your cards are compared by rate.',
  /** The detector did not recognise a cart or checkout page (Phase 13c review fix): the popup's read on open
   * says nothing; the button shows this. */
  'not-a-cart':
    'This page doesn’t look like a cart or checkout page. Open the store’s cart, then read it again.',
} as const;
/** The read found a cart or checkout page but not a certain amount: the popup compares by rate. */
export const RATES_READ_MESSAGES: string[] = [
  READ_COPY.withheld,
  READ_COPY['summary-missing'],
  READ_COPY['ambiguous-amount'],
];
