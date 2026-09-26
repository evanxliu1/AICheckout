import { z } from 'zod';
import { passphraseSchema } from './vault-crypto';

export const VAULT_SESSION_KEY = 'checkoutVaultSessionV1';
export const VAULT_DISCLOSURE_VERSION = 1;
export const vaultRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('checkout:vault-status') }),
  z.strictObject({ type: z.literal('checkout:vault-create'), passphrase: passphraseSchema, disclosureVersion: z.literal(VAULT_DISCLOSURE_VERSION) }),
  z.strictObject({ type: z.literal('checkout:vault-unlock'), passphrase: passphraseSchema }),
  z.strictObject({ type: z.literal('checkout:vault-lock') }),
  z.strictObject({ type: z.literal('checkout:vault-delete'), confirmed: z.literal(true) }),
]);
export type VaultRequest = z.infer<typeof vaultRequestSchema>;
export const vaultResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(false), error: z.string().min(1).max(1000) }),
  z.strictObject({ ok: z.literal(true), status: z.enum(['setup', 'migration', 'locked', 'unlocked', 'damaged']) }),
]);
export type VaultResponse = z.infer<typeof vaultResponseSchema>;
export type VaultStatus = Extract<VaultResponse, { ok: true }>['status'];
