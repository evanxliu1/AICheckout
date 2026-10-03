import {
  appStateSchema,
  emptyCatalogCache,
  emptyState,
  requestSchema,
  storedAppStateSchema,
} from './contracts';
import type { CheckoutResponse, StoredAppState } from './contracts';
import { CATALOG_KEY, createStateService, STATE_KEY } from './service';
import { currentCatalog } from './catalog';
import type { CartReader, StateStorage } from './service';
import {
  decryptVault,
  deriveVaultKey,
  encryptVault,
  newVaultIdentity,
  sessionKeySchema,
  vaultEnvelopeSchema,
} from './vault-crypto';
import { VAULT_SESSION_KEY, vaultRequestSchema } from './vault-contracts';
import type { VaultResponse, VaultStatus } from './vault-contracts';

const obsoleteKeys = [
  'openaiKey',
  'cachedCards',
  'lastCardsFetch',
  'latestRecommendation',
  'recommendationLogs',
  'debugMode',
];
const lockedMessage = 'Unlock your saved data before continuing.';
type Response = VaultResponse | CheckoutResponse;

/** One queue owns lifecycle events, vault transitions and domain writes. Saved state is plain
 * local storage by default; with the optional passphrase vault it is an authenticated envelope
 * whose usable key lives in session memory only. */
export function createVaultService(
  local: StateStorage,
  session: StateStorage,
  clock = Date.now,
  cartReader?: CartReader,
  fetchCatalog?: (signal: AbortSignal) => Promise<unknown>,
) {
  let queue = Promise.resolve<unknown>(undefined);
  const record = async () => (await local.get(STATE_KEY))[STATE_KEY];
  const sessionKey = async () =>
    sessionKeySchema.safeParse((await session.get(VAULT_SESSION_KEY))[VAULT_SESSION_KEY]);
  const ready = async () => {
    const envelope = vaultEnvelopeSchema.safeParse(await record()),
      key = await sessionKey();
    if (!envelope.success || !key.success || key.data.id !== envelope.data.id) throw new Error(lockedMessage);
    return { envelope: envelope.data, key: key.data };
  };
  async function status(): Promise<VaultStatus> {
    await local.remove(obsoleteKeys);
    const saved = await record();
    if (saved === undefined) return 'unprotected';
    const envelope = vaultEnvelopeSchema.safeParse(saved);
    if (!envelope.success) return storedAppStateSchema.safeParse(saved).success ? 'unprotected' : 'damaged';
    const key = await sessionKey();
    if (!key.success || key.data.id !== envelope.data.id) return 'locked';
    try {
      await decryptVault(envelope.data, key.data);
      return 'unlocked';
    } catch {
      await session.remove([VAULT_SESSION_KEY]);
      return 'damaged';
    }
  }
  async function clear() {
    // Lock first. A failed persistent clear leaves encrypted recoverable data, never
    // an unlocked session falsely presented as deleted.
    await session.clear();
    await local.clear();
  }
  /** Plain state (or nothing yet) when the vault is off; the decrypted envelope when it is on. */
  const isPlain = (saved: unknown) => saved === undefined || storedAppStateSchema.safeParse(saved).success;
  /** The catalog cache is public: never encrypted, readable while locked. It is written in the same
   * `local.set` as the state it belongs with, so both change together or not at all. */
  const protectedStorage: StateStorage = {
    get: async (key) => {
      if (key === CATALOG_KEY) return local.get(CATALOG_KEY);
      if (key !== STATE_KEY) throw new Error('Unsupported state key.');
      const saved = await record();
      if (isPlain(saved)) return saved === undefined ? {} : { [STATE_KEY]: saved };
      const unlocked = await ready();
      return { [STATE_KEY]: await decryptVault(unlocked.envelope, unlocked.key) };
    },
    set: async (items) => {
      const keys = Object.keys(items);
      if (!keys.length || keys.some((key) => key !== STATE_KEY && key !== CATALOG_KEY))
        throw new Error('Unsupported state write.');
      const write: Record<string, unknown> = {};
      if (Object.hasOwn(items, CATALOG_KEY)) write[CATALOG_KEY] = items[CATALOG_KEY];
      if (Object.hasOwn(items, STATE_KEY)) {
        const state = appStateSchema.parse(items[STATE_KEY]);
        if (isPlain(await record())) write[STATE_KEY] = state;
        else {
          const unlocked = await ready();
          write[STATE_KEY] = await encryptVault(state, unlocked.envelope, unlocked.key);
        }
      }
      await local.set(write);
    },
    remove: (keys) => local.remove(keys),
    clear,
  };
  const stateService = createStateService(protectedStorage, clock, cartReader, fetchCatalog);
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = queue.then(operation);
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  async function handle(input: unknown): Promise<Response> {
    const request = vaultRequestSchema.safeParse(input);
    try {
      if (request.success) {
        const value = request.data;
        if (value.type === 'checkout:vault-status') return { ok: true, status: await status() };
        if (value.type === 'checkout:vault-delete') {
          await clear();
          return { ok: true, status: 'unprotected' };
        }
        if (value.type === 'checkout:vault-remove') {
          const envelope = vaultEnvelopeSchema.safeParse(await record());
          if (!envelope.success) return { ok: false, error: 'Passphrase protection is already off.' };
          let state: StoredAppState;
          try {
            const key = await deriveVaultKey(value.passphrase, envelope.data);
            state = await decryptVault(envelope.data, key);
          } catch {
            return { ok: false, error: 'Could not turn off protection. Check your passphrase.' };
          }
          // One key replacement: the plain record replaces the envelope; then the key is dropped.
          await local.set({ [STATE_KEY]: state });
          await session.remove([VAULT_SESSION_KEY]);
          return { ok: true, status: 'unprotected' };
        }
        if (value.type === 'checkout:vault-lock') {
          // Only the key: per-tab badge state in session storage is not wallet data.
          await session.remove([VAULT_SESSION_KEY]);
          return { ok: true, status: await status() };
        }
        if (value.type === 'checkout:vault-create') {
          const saved = await record();
          if (saved !== undefined && !storedAppStateSchema.safeParse(saved).success) {
            return {
              ok: false,
              error: 'Saved data already exists. Unlock it, or explicitly delete it to start again.',
            };
          }
          const state: StoredAppState =
            saved === undefined ? emptyState() : storedAppStateSchema.parse(saved);
          const identity = newVaultIdentity(),
            key = await deriveVaultKey(value.passphrase, identity);
          const encrypted = await encryptVault(state, identity, key);
          // One key replacement migrates plaintext atomically; no fallback plaintext copy.
          await local.set({ [STATE_KEY]: encrypted });
          await local.remove(obsoleteKeys);
          await session.set({ [VAULT_SESSION_KEY]: key });
          return { ok: true, status: 'unlocked' };
        }
        if (value.type === 'checkout:vault-unlock') {
          const envelope = vaultEnvelopeSchema.safeParse(await record());
          if (!envelope.success)
            return { ok: false, error: 'Saved data could not be read. You can delete it to start again.' };
          try {
            const key = await deriveVaultKey(value.passphrase, envelope.data);
            await decryptVault(envelope.data, key);
            await session.set({ [VAULT_SESSION_KEY]: key });
            return { ok: true, status: 'unlocked' };
          } catch {
            return {
              ok: false,
              error: 'Could not unlock. Check your passphrase; saved data may also be damaged.',
            };
          }
        }
      }
      const normal = requestSchema.safeParse(input);
      if (!normal.success)
        return { ok: false, error: 'This request could not be read. Reopen the extension and try again.' };
      if (normal.data.type === 'checkout:clear') {
        await clear();
        return {
          ok: true,
          state: emptyState(),
          catalog: currentCatalog(emptyCatalogCache(), clock()),
          comparison: null,
          notice: 'Local data deleted.',
          catalogUpdatesAvailable: !!fetchCatalog,
        };
      }
      const current = await status();
      if (current === 'damaged')
        return { ok: false, error: 'Saved data could not be read. You can delete it to start again.' };
      if (current === 'locked') return { ok: false, error: lockedMessage };
      return await stateService(normal.data);
    } catch {
      return {
        ok: false,
        error: 'Protected storage could not be read or saved. Reopen the extension and try again.',
      };
    }
  }
  const service = (input: unknown) => serial(() => handle(input));
  service.invalidateTab = (tabId: number) =>
    serial(async () => {
      const current = await status();
      if (current === 'unlocked' || current === 'unprotected') await stateService.invalidateTab(tabId);
      // Locked captures are validated against the exact tab/document and age on unlock/use.
    });
  /** The current status and, when readable, the saved state and the catalog in effect. For the
   * badge, which only reads. */
  service.snapshot = () =>
    serial(async () => {
      const current = await status();
      if (current !== 'unlocked' && current !== 'unprotected')
        return { status: current, state: null, catalog: null };
      return { status: current, ...(await stateService.read()) };
    });
  return service;
}
