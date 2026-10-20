import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from '../domain';
import { GENERIC_READER_VERSION } from './merchants';
import { GENERIC_MERCHANT_ID } from '@ai-checkout/rewards-core/generic-merchant';

const readingFields = z.strictObject({
  status: z.literal('found'),
  /** The generic store, or (snapshots only, Phase 14.2) a merchant release record the worker resolved
   * from the tab's URL. */
  merchantId: z.string().min(1).max(100),
  currency: z.literal('USD'),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
  kind: z.enum(['total', 'estimated-total', 'subtotal']),
  /** The generic reader is the only reader since Phase 15.1; the retired adapters' `*-summary-v1`
   * versions are refused. */
  extractorVersion: z.literal(GENERIC_READER_VERSION),
});
/** A reading from a content script names only the generic store; the worker maps it to the tab's store. */
const reading = readingFields.extend({ merchantId: z.literal(GENERIC_MERCHANT_ID) });
export const probeSchema = z.strictObject({
  url: z.string().url().max(4096),
  reading: z.discriminatedUnion('status', [
    reading,
    z.strictObject({
      status: z.literal('unavailable'),
      reason: z.enum(['unsupported-page', 'empty-cart', 'unsupported-currency', 'withheld', 'not-a-cart']),
    }),
  ]),
});
export const cartSnapshotSchema = readingFields.omit({ status: true }).extend({
  id: z.string().uuid(),
  tabId: z.number().int().nonnegative(),
  documentId: z.string().min(1).max(100),
  pageKey: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.number().int().nonnegative(),
});
export type CartSnapshot = z.infer<typeof cartSnapshotSchema>;
/** The saved cart in a stored state. A snapshot a retired adapter wrote before Phase 15.1 (version
 * `*-summary-v1`, e.g. a Best Buy cart read from the popup) reads as no saved cart, so a state that still
 * holds one parses instead of being reported damaged; a comparison tied to it then asks for a new read. */
export const storedCartSnapshotSchema = z
  .union([
    cartSnapshotSchema,
    z.object({ extractorVersion: z.string().regex(/^[a-z0-9]+-summary-v[0-9]+$/) }).transform(() => null),
  ])
  .nullable();
