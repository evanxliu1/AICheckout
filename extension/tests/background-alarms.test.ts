import { afterEach, describe, expect, it, vi } from 'vitest';

/* Phase 14.6: the worker's weekly refresh alarm in a hosted build (both fetchers configured). */
const fetchCatalog = vi.fn<(signal: AbortSignal) => Promise<unknown>>();
const fetchMerchants = vi.fn<(signal: AbortSignal) => Promise<unknown>>();
vi.mock('../src/checkout/browser', () => ({ readActiveCheckout: vi.fn(), validateActiveCheckout: vi.fn() }));
vi.mock('../src/catalog-config', () => ({
  fetchPublishedCatalog: (signal: AbortSignal) => fetchCatalog(signal),
  fetchPublishedMerchants: (signal: AbortSignal) => fetchMerchants(signal),
  uninstalledUrl: 'https://api.example/uninstalled/',
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  fetchCatalog.mockReset();
  fetchMerchants.mockReset();
});

async function worker(existingAlarm?: { name: string; periodInMinutes: number }) {
  let onAlarm: ((alarm: { name: string }) => void) | undefined;
  let onInstalled: ((details: { reason: string }) => void) | undefined;
  let onStartup: (() => void) | undefined;
  const data: Record<string, unknown> = {};
  const storage = {
    get: vi.fn(async (key: string | null) =>
      key === null ? { ...data } : key in data ? { [key]: data[key] } : {},
    ),
    set: vi.fn(async (values: Record<string, unknown>) => {
      Object.assign(data, values);
    }),
    remove: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    setAccessLevel: vi.fn(async () => undefined),
  };
  const alarms = {
    get: vi.fn(async (name: string) => (existingAlarm?.name === name ? existingAlarm : undefined)),
    create: vi.fn(async () => undefined),
    onAlarm: {
      addListener: (handler: (alarm: { name: string }) => void) => {
        onAlarm = handler;
      },
    },
  };
  const sendMessage = vi.fn(async () => undefined);
  const setUninstallURL = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'our-extension',
      getURL: (path: string) => `chrome-extension://our-extension/${path}`,
      onMessage: { addListener: vi.fn() },
      setUninstallURL,
      onInstalled: {
        addListener: (handler: (details: { reason: string }) => void) => {
          onInstalled = handler;
        },
      },
      onStartup: {
        addListener: (handler: () => void) => {
          onStartup = handler;
        },
      },
      sendMessage,
    },
    action: { openPopup: vi.fn() },
    alarms,
    storage: { local: storage, session: { ...storage, get: vi.fn(async () => ({})) } },
    tabs: {
      onUpdated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      create: vi.fn(async () => undefined),
    },
  });
  const module = await import('../src/background/index');
  return {
    onAlarm: onAlarm!,
    onInstalled: onInstalled!,
    onStartup: onStartup!,
    alarms,
    sendMessage,
    setUninstallURL,
    data,
    module,
  };
}

const module_name = () => 'refresh-releases';

describe('weekly release refresh (Phase 14.6)', () => {
  it('creates the weekly alarm on install and refreshes both releases when it fires', async () => {
    const { onAlarm, onInstalled, alarms, sendMessage, data, module } = await worker();
    onInstalled({ reason: 'update' });
    await vi.waitFor(() =>
      expect(alarms.create).toHaveBeenCalledWith(module.REFRESH_ALARM, {
        delayInMinutes: module.REFRESH_FIRST_MINUTES,
        periodInMinutes: module.REFRESH_PERIOD_MINUTES,
      }),
    );
    expect(module.REFRESH_PERIOD_MINUTES).toBe(7 * 24 * 60);
    fetchCatalog.mockResolvedValue({ release: null });
    fetchMerchants.mockResolvedValue({ release: null });
    alarms.create.mockClear();
    onAlarm({ name: module.REFRESH_ALARM });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'badge:changed', tabId: null }));
    expect(fetchCatalog).toHaveBeenCalledOnce();
    expect(fetchMerchants).toHaveBeenCalledOnce();
    expect(data).toHaveProperty('checkoutMerchantsV1');
    expect(data).toHaveProperty('checkoutCatalogV1');
    // Nothing failed: no retry alarm.
    expect(alarms.create).not.toHaveBeenCalled();
  });
  it('schedules one retry when a fetch fails (the service asleep), and none after the retry', async () => {
    const { onAlarm, alarms, module } = await worker();
    fetchCatalog.mockResolvedValue({ release: null });
    fetchMerchants.mockRejectedValue(new TypeError('fetch failed'));
    onAlarm({ name: module.REFRESH_ALARM });
    await vi.waitFor(() =>
      expect(alarms.create).toHaveBeenCalledWith(module.REFRESH_RETRY_ALARM, {
        delayInMinutes: module.REFRESH_RETRY_MINUTES,
      }),
    );
    alarms.create.mockClear();
    onAlarm({ name: module.REFRESH_RETRY_ALARM });
    await vi.waitFor(() => expect(fetchMerchants).toHaveBeenCalledTimes(2));
    await new Promise((done) => setTimeout(done, 10));
    expect(alarms.create).not.toHaveBeenCalled();
  });
  it('keeps an existing alarm on browser startup and install, so restarts never reset the weekly period', async () => {
    const { onStartup, onInstalled, alarms, module } = await worker({
      name: module_name(),
      periodInMinutes: 7 * 24 * 60,
    });
    onStartup();
    onInstalled({ reason: 'update' });
    await vi.waitFor(() => expect(alarms.get).toHaveBeenCalledTimes(2));
    await new Promise((done) => setTimeout(done, 10));
    expect(alarms.create).not.toHaveBeenCalled();
    expect(module.REFRESH_ALARM).toBe(module_name());
  });
  it('creates the alarm on browser startup when it is missing', async () => {
    const { onStartup, alarms, module } = await worker();
    onStartup();
    await vi.waitFor(() =>
      expect(alarms.create).toHaveBeenCalledWith(module.REFRESH_ALARM, {
        delayInMinutes: module.REFRESH_FIRST_MINUTES,
        periodInMinutes: module.REFRESH_PERIOD_MINUTES,
      }),
    );
  });
  /* Phase 15.4: a new install refreshes both releases at once; the weekly alarm is still created once. */
  it('refreshes both releases once right at install, creates the weekly alarm once, and tells open pages', async () => {
    const { onInstalled, alarms, sendMessage, setUninstallURL, data, module } = await worker();
    fetchCatalog.mockResolvedValue({ release: null });
    fetchMerchants.mockResolvedValue({ release: null });
    onInstalled({ reason: 'install' });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'terms:checked' }));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'badge:changed', tabId: null });
    expect(fetchCatalog).toHaveBeenCalledOnce();
    expect(fetchMerchants).toHaveBeenCalledOnce();
    expect(data).toHaveProperty('checkoutCatalogV1');
    expect(data).toHaveProperty('checkoutMerchantsV1');
    expect(alarms.create).toHaveBeenCalledOnce();
    expect(alarms.create).toHaveBeenCalledWith(module.REFRESH_ALARM, {
      delayInMinutes: module.REFRESH_FIRST_MINUTES,
      periodInMinutes: module.REFRESH_PERIOD_MINUTES,
    });
    // A hosted build names the site's static page, with no parameters.
    expect(setUninstallURL).toHaveBeenCalledWith('https://api.example/uninstalled/');
  });
  it('schedules no retry of its own when the install refresh fails: the weekly alarm, due two minutes later, retries', async () => {
    const { onInstalled, alarms, sendMessage } = await worker();
    fetchCatalog.mockRejectedValue(new TypeError('fetch failed'));
    fetchMerchants.mockRejectedValue(new TypeError('fetch failed'));
    onInstalled({ reason: 'install' });
    // Pages still learn that the check settled, so "Checking…" gives way to the expired copy.
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'terms:checked' }));
    expect(fetchCatalog).toHaveBeenCalledOnce();
    expect(alarms.create).toHaveBeenCalledOnce();
    expect(alarms.create).not.toHaveBeenCalledWith('refresh-releases-retry', expect.anything());
  });
  it('does not refresh on an extension update (the bundle is new; the weekly alarm goes on)', async () => {
    const { onInstalled } = await worker({ name: module_name(), periodInMinutes: 7 * 24 * 60 });
    onInstalled({ reason: 'update' });
    await new Promise((done) => setTimeout(done, 10));
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(fetchMerchants).not.toHaveBeenCalled();
  });
  it('ignores alarms it did not create', async () => {
    const { onAlarm } = await worker();
    onAlarm({ name: 'something-else' });
    await new Promise((done) => setTimeout(done, 10));
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(fetchMerchants).not.toHaveBeenCalled();
  });
});
