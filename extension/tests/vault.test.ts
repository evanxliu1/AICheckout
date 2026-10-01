// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { emptyState } from '../src/state/contracts';
import type { AppState } from '../src/state/contracts';
import { createVaultService } from '../src/state/vault-service';
import { STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { VAULT_SESSION_KEY } from '../src/state/vault-contracts';
import {
  decryptVault,
  deriveVaultKey,
  encryptVault,
  newVaultIdentity,
  VAULT_ITERATIONS,
} from '../src/state/vault-crypto';

const phrase = 'test-only purple canyon lantern';
const clock = () => Date.parse('2026-09-26T12:00:00Z');
function memory(initial: Record<string, unknown> = {}) {
  let data = structuredClone(initial);
  const api: StateStorage = {
    get: async (key) => ({ [key]: structuredClone(data[key]) }),
    set: async (items) => {
      data = { ...data, ...structuredClone(items) };
    },
    remove: async (keys) => {
      for (const key of keys) delete data[key];
    },
    clear: async () => {
      data = {};
    },
  };
  return { api, read: () => structuredClone(data) };
}
const create = { type: 'checkout:vault-create', passphrase: phrase, disclosureVersion: 1 };
const unlock = { type: 'checkout:vault-unlock', passphrase: phrase };
const wallet = {
  defaultCardId: 'capital-one-quicksilver',
  cards: [{ cardId: 'capital-one-quicksilver', usage: [] }],
};
const legacy: AppState = {
  ...emptyState(),
  wallet,
  purchase: {
    merchantId: 'newegg-us',
    currency: 'USD',
    amountCents: 98765,
    purchasedOn: '2026-09-26',
    eligiblePurchase: 'eligible',
    onlineRetail: 'unknown',
  },
};

describe('authenticated passphrase encryption', () => {
  it('uses salted expensive derivation and fresh IVs; binds headers and encrypted data', async () => {
    const identity = newVaultIdentity(),
      key = await deriveVaultKey(phrase, identity);
    const a = await encryptVault(legacy, identity, key),
      b = await encryptVault(legacy, identity, key);
    expect(a.iterations).toBe(VAULT_ITERATIONS);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await decryptVault(a, key)).toEqual(legacy);
    expect(JSON.stringify(a)).not.toContain('quicksilver');
    expect(JSON.stringify(a)).not.toContain('newegg-us');
    expect(JSON.stringify(a)).not.toContain(phrase);
    for (const tampered of [
      { ...a, revision: 1 },
      { ...a, salt: newVaultIdentity().salt },
      { ...a, iv: b.iv },
      { ...a, ciphertext: a.ciphertext.slice(0, -8) + 'AAAAAAAA' },
      { ...a, iterations: 1 },
      { ...a, version: 2 },
      { ...a, unwanted: 'field' },
    ])
      await expect(decryptVault(tampered, key)).rejects.toThrow();
    const wrong = await deriveVaultKey('different long passphrase', identity);
    await expect(decryptVault(a, wrong)).rejects.toThrow();
    const other = await deriveVaultKey(phrase, newVaultIdentity());
    expect(other.key).not.toBe(key.key);
    await expect(decryptVault(a, other)).rejects.toThrow();
  });
  it('rejects oversized passphrases, truncated noncanonical encoding and invalid state', async () => {
    const identity = newVaultIdentity();
    await expect(deriveVaultKey('short', identity)).rejects.toThrow();
    await expect(deriveVaultKey('x'.repeat(257), identity)).rejects.toThrow();
    await expect(deriveVaultKey(phrase, { ...identity, salt: 'AAAA' })).rejects.toThrow();
    const key = await deriveVaultKey(phrase, identity),
      encrypted = await encryptVault(legacy, identity, key);
    await expect(decryptVault({ ...encrypted, ciphertext: 'AAA=' }, key)).rejects.toThrow();
    await expect(
      encryptVault({ ...legacy, schemaVersion: 99 } as unknown as AppState, identity, key),
    ).rejects.toThrow();
  });
});

describe('protected storage lifecycle', () => {
  it('requires setup/consent; saves only ciphertext and keeps the usable key out of local storage', async () => {
    const local = memory(),
      session = memory(),
      service = createVaultService(local.api, session.api, clock);
    expect(await service({ type: 'checkout:vault-status' })).toEqual({ ok: true, status: 'setup' });
    expect(await service({ type: 'checkout:get-state' })).toMatchObject({ ok: false });
    expect(await service({ ...create, disclosureVersion: undefined })).toMatchObject({ ok: false });
    expect(local.read()).toEqual({});
    expect(await service(create)).toEqual({ ok: true, status: 'unlocked' });
    expect(await service({ type: 'checkout:save-wallet', expectedRevision: 0, wallet })).toMatchObject({
      ok: true,
      state: { wallet },
    });
    const disk = JSON.stringify(local.read()),
      ram = session.read()[VAULT_SESSION_KEY] as { key: string };
    expect(disk).not.toContain('quicksilver');
    expect(disk).not.toContain(ram.key);
    expect(disk).not.toContain(phrase);
    expect(await service(create)).toMatchObject({ ok: false });
    expect(await service({ type: 'checkout:get-state' })).toMatchObject({ ok: true, state: { wallet } });
  });
  it('survives worker restart, locks after session loss, and refuses a wrong passphrase without mutations', async () => {
    const local = memory(),
      session = memory();
    let service = createVaultService(local.api, session.api, clock);
    await service(create);
    await service({ type: 'checkout:save-wallet', expectedRevision: 0, wallet });
    service = createVaultService(local.api, session.api, clock);
    expect(await service({ type: 'checkout:vault-status' })).toEqual({ ok: true, status: 'unlocked' });
    await session.api.clear();
    expect(await service({ type: 'checkout:vault-status' })).toEqual({ ok: true, status: 'locked' });
    const before = local.read();
    expect(await service({ ...unlock, passphrase: 'incorrect but long enough' })).toMatchObject({
      ok: false,
    });
    expect(local.read()).toEqual(before);
    expect(session.read()).toEqual({});
    expect(await service({ type: 'checkout:get-state' })).toMatchObject({ ok: false });
    expect(await service(unlock)).toEqual({ ok: true, status: 'unlocked' });
    expect(await service({ type: 'checkout:get-state' })).toMatchObject({ ok: true, state: { wallet } });
    expect(await service({ type: 'checkout:vault-lock' })).toEqual({ ok: true, status: 'locked' });
    expect(session.read()).toEqual({});
  });
  it('migrates the same state key only after consent and preserves every validated input', async () => {
    const local = memory({ [STATE_KEY]: legacy, openaiKey: 'obsolete-test-key' }),
      session = memory();
    const service = createVaultService(local.api, session.api, clock);
    expect(await service({ type: 'checkout:vault-status' })).toEqual({ ok: true, status: 'migration' });
    expect(local.read()[STATE_KEY]).toEqual(legacy);
    expect(local.read()).not.toHaveProperty('openaiKey');
    expect(await service(create)).toEqual({ ok: true, status: 'unlocked' });
    expect(Object.keys(local.read())).toEqual([STATE_KEY]);
    expect(await service({ type: 'checkout:get-state' })).toMatchObject({ ok: true, state: legacy });
    expect(JSON.stringify(local.read())).not.toContain('newegg-us');
  });
  it('preserves plaintext on a failed migration write; a failed session write leaves unlockable ciphertext', async () => {
    const local = memory({ [STATE_KEY]: legacy }),
      session = memory();
    const failedWrite = createVaultService(
      {
        ...local.api,
        set: async () => {
          throw Error('disk');
        },
      },
      session.api,
      clock,
    );
    expect(await failedWrite(create)).toMatchObject({ ok: false });
    expect(local.read()[STATE_KEY]).toEqual(legacy);
    expect(session.read()).toEqual({});
    const failedSession = createVaultService(
      local.api,
      {
        ...session.api,
        set: async () => {
          throw Error('session');
        },
      },
      clock,
    );
    expect(await failedSession(create)).toMatchObject({ ok: false });
    expect(local.read()[STATE_KEY]).toMatchObject({ kind: 'encrypted-vault' });
    const recovered = createVaultService(local.api, session.api, clock);
    expect(await recovered(unlock)).toEqual({ ok: true, status: 'unlocked' });
    expect(await recovered({ type: 'checkout:get-state' })).toMatchObject({ ok: true, state: legacy });
  });
  it('rejects damaged state and never replaces it during setup/unlock', async () => {
    const local = memory({ [STATE_KEY]: { schemaVersion: 99, secret: 'test-only' } }),
      session = memory();
    const service = createVaultService(local.api, session.api, clock),
      before = local.read();
    expect(await service({ type: 'checkout:vault-status' })).toEqual({ ok: true, status: 'damaged' });
    expect(await service(create)).toMatchObject({ ok: false });
    expect(await service(unlock)).toMatchObject({ ok: false });
    expect(local.read()).toEqual(before);
  });
  it('requires explicit destructive confirmation and clears local plus session state while locked', async () => {
    const local = memory(),
      session = memory(),
      service = createVaultService(local.api, session.api, clock);
    await service(create);
    await service({ type: 'checkout:vault-lock' });
    expect(await service({ type: 'checkout:vault-delete', confirmed: false })).toMatchObject({ ok: false });
    expect(local.read()).toHaveProperty(STATE_KEY);
    expect(await service({ type: 'checkout:vault-delete', confirmed: true })).toEqual({
      ok: true,
      status: 'setup',
    });
    expect(local.read()).toEqual({});
    expect(session.read()).toEqual({});
  });
  it('locks even when deletion fails; saved ciphertext can still be unlocked', async () => {
    const local = memory(),
      session = memory();
    const service = createVaultService(
      {
        ...local.api,
        clear: async () => {
          throw Error('disk');
        },
      },
      session.api,
      clock,
    );
    await service(create);
    expect(await service({ type: 'checkout:vault-delete', confirmed: true })).toMatchObject({ ok: false });
    expect(session.read()).toEqual({});
    expect(await service({ type: 'checkout:vault-status' })).toEqual({ ok: true, status: 'locked' });
    expect(await service(unlock)).toEqual({ ok: true, status: 'unlocked' });
  });
  it('serializes a delayed capture before deletion so late work cannot resurrect data', async () => {
    const local = memory(),
      session = memory();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const service = createVaultService(local.api, session.api, clock, {
      read: async () => {
        started();
        return (await pending) as never;
      },
      validate: async () => undefined,
    });
    await service(create);
    const read = service({ type: 'checkout:read-cart', expectedRevision: 0 });
    await reading;
    const deletion = service({ type: 'checkout:vault-delete', confirmed: true });
    finish({
      id: crypto.randomUUID(),
      merchantId: 'newegg-us',
      currency: 'USD',
      amountCents: 24999,
      kind: 'subtotal',
      extractorVersion: 'newegg-summary-v1',
      tabId: 7,
      documentId: 'doc',
      pageKey: 'a'.repeat(64),
      capturedAt: clock(),
    });
    expect(await read).toMatchObject({ ok: true });
    expect(await deletion).toEqual({ ok: true, status: 'setup' });
    expect(local.read()).toEqual({});
    expect(session.read()).toEqual({});
  });
});

describe('pilot-era (schema 1) vault migration', () => {
  it('decrypts a v1 envelope, migrates once, and re-encrypts schema 2 with a bumped revision', async () => {
    const identity = newVaultIdentity(),
      key = await deriveVaultKey(phrase, identity);
    const pilot = {
      ...legacy,
      schemaVersion: 1,
      revision: 7,
      wallet: {
        defaultCardId: 'amex-blue-cash-everyday',
        cards: [
          {
            cardId: 'amex-blue-cash-everyday',
            usage: [
              {
                ruleId: 'bce-retired',
                calendarYear: 2026,
                recordedOn: '2026-09-26',
                spentCents: 0,
                activation: 'unknown',
              },
            ],
          },
        ],
      },
    };
    const envelope = await encryptVault(pilot as unknown as AppState, identity, key);
    const local = memory({ [STATE_KEY]: envelope }),
      session = memory();
    const service = createVaultService(local.api, session.api, clock);
    expect(await service({ type: 'checkout:vault-status' })).toEqual({ ok: true, status: 'locked' });
    expect(await service(unlock)).toEqual({ ok: true, status: 'unlocked' });
    const read = await service({ type: 'checkout:get-state' });
    expect(read).toMatchObject({ ok: true, notice: expect.stringContaining('review your cards') });
    const stored = await decryptVault(local.read()[STATE_KEY], session.read()[VAULT_SESSION_KEY] as never);
    expect(stored).toMatchObject({ schemaVersion: 2, revision: 8, pendingNotice: null });
    expect(stored.wallet.cards[0].usage).toEqual([]);
  });
});
