import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from '../domain';
import { GENERIC_READER_VERSION, MERCHANT_IDS, MERCHANTS, type MerchantId } from './merchants';
import { GENERIC_MERCHANT_ID } from '@ai-checkout/rewards-core/generic-merchant';

const readingFields = z.strictObject({
  status: z.literal('found'),
  merchantId: z.enum([...MERCHANT_IDS, GENERIC_MERCHANT_ID]),
  currency: z.literal('USD'),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
  kind: z.enum(['total', 'estimated-total', 'subtotal']),
  // A legacy reading carries its merchant's bundled adapter version; a generic (`readCart`) reading,
  // at any merchant, the generic version (refined below).
  extractorVersion: z.union([
    z.string().regex(/^[a-z0-9]+-summary-v[0-9]+$/),
    z.literal(GENERIC_READER_VERSION),
  ]),
});
const matchingReader = (value: { merchantId: string; extractorVersion: string }) =>
  value.extractorVersion === GENERIC_READER_VERSION ||
  (Object.hasOwn(MERCHANTS, value.merchantId) &&
    value.extractorVersion === MERCHANTS[value.merchantId as MerchantId].extractorVersion);
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
        'withheld',
        'not-a-cart',
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
