import { z } from 'zod';
import { READING_KINDS } from './types.ts';

/** Zod contract of one reader output; the evaluation harness validates every read against it. */
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
