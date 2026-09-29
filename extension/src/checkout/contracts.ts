import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from '../domain';
import { MERCHANT_IDS, MERCHANTS } from './merchants';

const readingFields = z.strictObject({
  status: z.literal('found'),
  merchantId: z.enum(MERCHANT_IDS),
  currency: z.literal('USD'),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
  kind: z.enum(['total', 'estimated-total', 'subtotal']),
  extractorVersion: z.enum(['bestbuy-summary-v1', 'newegg-summary-v1']),
});
const matchingReader = (value: { merchantId: (typeof MERCHANT_IDS)[number]; extractorVersion: string }) =>
  value.extractorVersion === MERCHANTS[value.merchantId].extractorVersion;
const reading = readingFields.refine(matchingReader, 'Reader version does not match merchant.');
export const probeSchema = z.strictObject({
  url: z.string().url().max(4096),
  reading: z.discriminatedUnion('status', [
    reading,
    z.strictObject({
      status: z.literal('unavailable'),
      reason: z.enum([
        'unsupported-page',
        'empty-cart',
        'summary-missing',
        'ambiguous-amount',
        'unsupported-currency',
        'page-loading',
      ]),
    }),
  ]),
});
export const cartSnapshotSchema = readingFields
  .omit({ status: true })
  .extend({
    id: z.string().uuid(),
    tabId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(100),
    pageKey: z.string().regex(/^[a-f0-9]{64}$/),
    capturedAt: z.number().int().nonnegative(),
  })
  .refine(matchingReader, 'Reader version does not match merchant.');
export type CartSnapshot = z.infer<typeof cartSnapshotSchema>;
