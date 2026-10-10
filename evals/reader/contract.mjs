// The reader's output contract, owned by the harness (not by packages/cart-reader, so the reader developer can't
// loosen it). Every read is checked against it; anything else is a crash.
import { z } from 'zod';

export const READING_KINDS = ['afterCredit', 'estimatedTotal', 'subtotal'];
export const cartReadingSchema = z.discriminatedUnion('shown', [
  z.strictObject({
    shown: z.literal(true),
    kind: z.enum(READING_KINDS),
    amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  z.strictObject({
    shown: z.literal(false),
    reason: z.string().regex(/^[a-z0-9-]{1,64}$/),
  }),
]);

/** The cart page detector's output contract (Phase 13c): a page kind and a short machine reason. */
export const pageDetectionSchema = z.strictObject({
  page: z.enum(['cart', 'checkout', 'none']),
  reason: z.string().regex(/^[a-z0-9-]{1,64}$/),
});
