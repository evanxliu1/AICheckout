// Delete all local data in a build with usage reporting (Phase 15.5b): while sharing is on, the worker deletes the
// reports stored under the identifier before `chrome.storage.local.clear()`, which would otherwise take the
// identifier with it. Only a 2xx from `/v1/events/delete` lets the clear proceed; otherwise nothing is cleared
// and the page is told so. `keepReports` ("Clear this device anyway") skips the service.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REPORTS_NOT_DELETED_MESSAGE } from '../src/state/telemetry-contracts';
import { TELEMETRY_KEY } from '../src/state/keys';

vi.mock('../src/checkout/browser', () => ({ readActiveCheckout: vi.fn(), validateActiveCheckout: vi.fn() }));
const deleteInstall = vi.fn();
vi.mock('../src/catalog-config', () => ({
  fetchPublishedCatalog: undefined,
  fetchPublishedMerchants: undefined,
  uninstalledUrl: undefined,
  telemetryClient: {
    send: vi.fn(),
    deleteInstall: (id: string, signal: AbortSignal) => deleteInstall(id, signal),
  },
}));

type Listener = (
  request: unknown,
  sender: { id?: string; url?: string },
  sendResponse: (response: unknown) => void,
) => boolean | undefined;
const popup = { id: 'our-extension', url: 'chrome-extension://our-extension/src/popup/index.html' };
const INSTALL_ID = 'c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  deleteInstall.mockReset();
});

/** The worker with a shopper who shares (an identifier in the telemetry state) and plain, unprotected state. */
async function background() {
  let listener: Listener;
  const stored: Record<string, unknown> = {
    [TELEMETRY_KEY]: {
      consent: 'granted',
      consentVersion: 1,
      installId: INSTALL_ID,
      installedAt: 1_700_000_000_000,
      queue: [],
      pausedUntil: null,
      retryAt: null,
      errorDay: null,
      errorCount: 0,
    },
  };
  const area = () => ({
    get: vi.fn(async (key: string | string[]) =>
      Object.fromEntries(
        (Array.isArray(key) ? key : [key]).filter((k) => k in stored).map((k) => [k, stored[k]]),
      ),
    ),
    set: vi.fn(async (items: Record<string, unknown>) => Object.assign(stored, items)),
    remove: vi.fn(async () => undefined),
    clear: vi.fn(async () => {
      for (const key of Object.keys(stored)) delete stored[key];
    }),
    setAccessLevel: vi.fn(async () => undefined),
  });
  const local = area(),
    session = area();
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'our-extension',
      getURL: (path: string) => `chrome-extension://our-extension/${path}`,
      getManifest: () => ({ version: '2.1.0' }),
      onMessage: {
        addListener: (handler: Listener) => {
          listener = handler;
        },
      },
      onInstalled: { addListener: vi.fn() },
      sendMessage: vi.fn(async () => undefined),
    },
    action: { openPopup: vi.fn() },
    alarms: {
      get: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
      clear: vi.fn(async () => true),
      onAlarm: { addListener: vi.fn() },
    },
    storage: { local, session },
    tabs: { onUpdated: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } },
  });
  await import('../src/background/index');
  const ask = (request: unknown) =>
    new Promise<unknown>((resolve) => {
      listener!(request, popup, resolve);
    });
  return { ask, local, stored };
}

describe('Delete all local data deletes the usage reports first', () => {
  it.each(['checkout:vault-delete', 'checkout:clear'] as const)(
    '%s: a refused deletion (503) clears nothing and answers with the shared message',
    async (type) => {
      const { ask, local, stored } = await background();
      deleteInstall.mockResolvedValue({ status: 503 });
      const request = type === 'checkout:vault-delete' ? { type, confirmed: true } : { type };
      expect(await ask(request)).toEqual({ ok: false, error: REPORTS_NOT_DELETED_MESSAGE });
      expect(deleteInstall).toHaveBeenCalledWith(INSTALL_ID, expect.any(AbortSignal));
      expect(local.clear).not.toHaveBeenCalled();
      expect((stored[TELEMETRY_KEY] as { installId: string }).installId).toBe(INSTALL_ID);
    },
  );
  it('a network failure is the same: nothing is cleared, the identifier stays', async () => {
    const { ask, local } = await background();
    deleteInstall.mockRejectedValue(new TypeError('offline'));
    expect(await ask({ type: 'checkout:vault-delete', confirmed: true })).toEqual({
      ok: false,
      error: REPORTS_NOT_DELETED_MESSAGE,
    });
    expect(local.clear).not.toHaveBeenCalled();
  });
  it('a 2xx deletes the reports, then clears the device', async () => {
    const { ask, local, stored } = await background();
    deleteInstall.mockResolvedValue({ status: 200 });
    expect(await ask({ type: 'checkout:vault-delete', confirmed: true })).toEqual({
      ok: true,
      status: 'unprotected',
    });
    expect(deleteInstall).toHaveBeenCalledWith(INSTALL_ID, expect.any(AbortSignal));
    expect(local.clear).toHaveBeenCalledOnce();
    expect(stored[TELEMETRY_KEY]).toBeUndefined();
    // The deletion came before the clear: the id was still there to send.
    expect(deleteInstall.mock.invocationCallOrder[0]).toBeLessThan(local.clear.mock.invocationCallOrder[0]!);
  });
  it('a malformed clear (no confirmation) deletes nothing on the service and clears nothing', async () => {
    const { ask, local, stored } = await background();
    deleteInstall.mockResolvedValue({ status: 200 });
    expect(await ask({ type: 'checkout:vault-delete' })).toMatchObject({ ok: false });
    expect(await ask({ type: 'checkout:clear', confirmed: true })).toMatchObject({ ok: false });
    expect(deleteInstall).not.toHaveBeenCalled();
    expect(local.clear).not.toHaveBeenCalled();
    expect(stored[TELEMETRY_KEY]).toMatchObject({ consent: 'granted', installId: INSTALL_ID });
  });
  it('not sharing: the service is not asked and the clear goes ahead as before', async () => {
    const { ask, local, stored } = await background();
    (stored[TELEMETRY_KEY] as Record<string, unknown>).consent = 'declined';
    (stored[TELEMETRY_KEY] as Record<string, unknown>).installId = null;
    expect(await ask({ type: 'checkout:clear' })).toMatchObject({ ok: true });
    expect(deleteInstall).not.toHaveBeenCalled();
    expect(local.clear).toHaveBeenCalledOnce();
  });
  it('Clear this device anyway (keepReports) skips the service and clears', async () => {
    const { ask, local } = await background();
    expect(await ask({ type: 'checkout:vault-delete', confirmed: true, keepReports: true })).toEqual({
      ok: true,
      status: 'unprotected',
    });
    expect(deleteInstall).not.toHaveBeenCalled();
    expect(local.clear).toHaveBeenCalledOnce();
  });
});
