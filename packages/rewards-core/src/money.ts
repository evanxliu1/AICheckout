/** Product limit: USD 100,000 per purchase; reject malformed or ambiguous input. */
export const MAX_AMOUNT_CENTS = 10_000_000;

export function parseUsd(value: string): number | null {
  const text = value.trim().replace(/^\$\s*/, '');
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replaceAll(',', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

export function formatUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid money amount.');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** Aggregate exact integer products, then truncate to a cent for a conservative estimate.
 * Issuers may round across an entire billing period instead; this is not a posted reward. */
export function rewardCents(amountCents: number, baseBps: number, bonusSpendCents = 0, bonusBps = baseBps): number {
  if (![amountCents, baseBps, bonusSpendCents, bonusBps].every(Number.isSafeInteger) ||
    amountCents < 0 || amountCents > MAX_AMOUNT_CENTS || baseBps < 0 ||
    bonusBps < baseBps || bonusBps > 10_000 || bonusSpendCents < 0 || bonusSpendCents > amountCents) {
    throw new Error('Invalid reward operands.');
  }
  const numerator = BigInt(amountCents) * BigInt(baseBps) + BigInt(bonusSpendCents) * BigInt(bonusBps - baseBps);
  return Number(numerator / 10_000n);
}
