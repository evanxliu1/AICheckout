import { z } from 'zod';
import { passphraseSchema } from './vault-crypto';

export const VAULT_SESSION_KEY = 'checkoutVaultSessionV1';
export const VAULT_DISCLOSURE_VERSION = 1;
export const vaultRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('checkout:vault-status') }),
  z.strictObject({
    type: z.literal('checkout:vault-create'),
    passphrase: passphraseSchema,
    disclosureVersion: z.literal(VAULT_DISCLOSURE_VERSION),
  }),
  z.strictObject({ type: z.literal('checkout:vault-unlock'), passphrase: passphraseSchema }),
  z.strictObject({ type: z.literal('checkout:vault-lock') }),
  /** Delete all local data. While sharing is on, the worker first deletes the reports stored under the usage
   * identifier (as Delete my data does) and clears this device only when that succeeded; `keepReports` is the
   * shopper's "Clear this device anyway" after that step failed. */
  z.strictObject({
    type: z.literal('checkout:vault-delete'),
    confirmed: z.literal(true),
    keepReports: z.literal(true).optional(),
  }),
  /** Turns passphrase protection off: the saved state is decrypted back to plain local storage. */
  z.strictObject({ type: z.literal('checkout:vault-remove'), passphrase: passphraseSchema }),
]);
export type VaultRequest = z.infer<typeof vaultRequestSchema>;
export const vaultResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(false), error: z.string().min(1).max(1000) }),
  z.strictObject({
    ok: z.literal(true),
    /** unprotected: plain local storage (the default; also no data yet). locked/unlocked: the
     * optional passphrase vault. damaged: the saved record cannot be read. */
    status: z.enum(['unprotected', 'locked', 'unlocked', 'damaged']),
  }),
]);
export type VaultResponse = z.infer<typeof vaultResponseSchema>;
export type VaultStatus = Extract<VaultResponse, { ok: true }>['status'];
