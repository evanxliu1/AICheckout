import { z } from 'zod';
import { appStateSchema } from './contracts';
import type { AppState } from './contracts';

export const VAULT_ITERATIONS = 600_000;
export const MAX_VAULT_BYTES = 512 * 1024;
export const PASSPHRASE_MIN_LENGTH = 15;
export const passphraseSchema = z.string().min(PASSPHRASE_MIN_LENGTH).max(256);
const encoded = (max: number) => z.string().min(1).max(max).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const vaultEnvelopeSchema = z.strictObject({
  kind: z.literal('encrypted-vault'), version: z.literal(1), id: z.string().uuid(),
  kdf: z.literal('PBKDF2-SHA256'), iterations: z.literal(VAULT_ITERATIONS), salt: encoded(24),
  cipher: z.literal('AES-GCM-256'), iv: encoded(16),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  ciphertext: encoded(Math.ceil((MAX_VAULT_BYTES + 16) / 3) * 4),
});
export type VaultEnvelope = z.infer<typeof vaultEnvelopeSchema>;
export type VaultIdentity = Pick<VaultEnvelope, 'id' | 'salt'>;
export const sessionKeySchema = z.strictObject({ version: z.literal(1), id: z.string().uuid(), key: encoded(44) });
export type VaultSessionKey = z.infer<typeof sessionKeySchema>;
const encoder = new TextEncoder();

export function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export function decodeBytes(value: string, length?: number): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (encodeBytes(bytes) !== value || (length !== undefined && bytes.length !== length)) throw new Error('Invalid vault encoding.');
  return bytes;
}
function aad(envelope: Omit<VaultEnvelope, 'ciphertext' | 'iv'>): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(['ai-checkout/local-vault', envelope.version, envelope.id,
    envelope.kdf, envelope.iterations, envelope.salt, envelope.cipher, envelope.revision]));
}
async function importCipherKey(raw: string) {
  const bytes = decodeBytes(raw, 32);
  try { return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  finally { bytes.fill(0); }
}
export function newVaultIdentity(): VaultIdentity {
  return { id: crypto.randomUUID(), salt: encodeBytes(crypto.getRandomValues(new Uint8Array(16))) };
}
export async function deriveVaultKey(passphrase: string, identity: VaultIdentity): Promise<VaultSessionKey> {
  passphraseSchema.parse(passphrase);
  const bytes = encoder.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256',
      salt: decodeBytes(identity.salt, 16), iterations: VAULT_ITERATIONS }, material, 256));
    try { return { version: 1, id: identity.id, key: encodeBytes(raw) }; }
    finally { raw.fill(0); }
  } finally { bytes.fill(0); }
}
export async function encryptVault(state: AppState, identity: VaultIdentity, session: VaultSessionKey): Promise<VaultEnvelope> {
  const value = appStateSchema.parse(state);
  if (session.id !== identity.id) throw new Error('Vault session changed.');
  decodeBytes(identity.salt, 16);
  const bytes = encoder.encode(JSON.stringify(value));
  try {
    if (bytes.byteLength > MAX_VAULT_BYTES) throw new Error('Saved data is too large.');
    const header = { kind: 'encrypted-vault', version: 1, id: identity.id, salt: identity.salt, kdf: 'PBKDF2-SHA256', iterations: VAULT_ITERATIONS,
      cipher: 'AES-GCM-256', revision: value.revision } as const;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(header), tagLength: 128 },
      await importCipherKey(session.key), bytes);
    return vaultEnvelopeSchema.parse({ ...header, iv: encodeBytes(iv), ciphertext: encodeBytes(new Uint8Array(ciphertext)) });
  } finally { bytes.fill(0); }
}
export async function decryptVault(input: unknown, session: VaultSessionKey): Promise<AppState> {
  const envelope = vaultEnvelopeSchema.parse(input);
  if (session.id !== envelope.id) throw new Error('Vault session changed.');
  decodeBytes(envelope.salt, 16);
  const ciphertext = decodeBytes(envelope.ciphertext);
  if (ciphertext.byteLength < 16 || ciphertext.byteLength > MAX_VAULT_BYTES + 16) throw new Error('Invalid vault size.');
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBytes(envelope.iv, 12),
    additionalData: aad(envelope), tagLength: 128 }, await importCipherKey(session.key), ciphertext));
  try {
    const state = appStateSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
    if (state.revision !== envelope.revision) throw new Error('Vault revision does not match.');
    return state;
  } finally { plaintext.fill(0); }
}
