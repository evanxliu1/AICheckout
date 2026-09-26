import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/checkout/browser', () => ({ readActiveCheckout: vi.fn(), validateActiveCheckout: vi.fn() }));

type Listener = (request: unknown, sender: { id?: string; url?: string }, sendResponse: (response: unknown) => void) => boolean | undefined;
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function background(accessFails?: 'local' | 'session') {
  let listener: Listener;
  const get = vi.fn(async () => ({}));
  vi.stubGlobal('chrome', {
    runtime: { id: 'our-extension', getURL: (path: string) => `chrome-extension://our-extension/${path}`,
      onMessage: { addListener: (handler: Listener) => { listener = handler; } } },
    storage: Object.fromEntries(['local', 'session'].map(area => [area, { get, set: vi.fn(), remove: vi.fn(), clear: vi.fn(),
      setAccessLevel: vi.fn(async () => { if (accessFails === area) throw new Error('denied'); }) }])),
    tabs: { onUpdated: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } },
  });
  await import('../src/background/index');
  return { listener: listener!, get };
}

describe('worker message authorization', () => {
  it('accepts only the packaged popup and preserves the async response channel', async () => {
    const { listener, get } = await background();
    const respond = vi.fn();
    expect(listener({ type: 'checkout:vault-status' }, { id: 'our-extension', url: 'chrome-extension://our-extension/src/popup/index.html' }, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true, status: 'setup' }));
    expect(get).toHaveBeenCalledOnce();
    for (const storage of [chrome.storage.local, chrome.storage.session]) {
      expect(storage.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
  });
  it.each([
    { id: 'our-extension', url: 'https://www.bestbuy.com/cart' },
    { id: 'another-extension', url: 'chrome-extension://our-extension/src/popup/index.html' },
    { id: 'our-extension', url: 'chrome-extension://our-extension/arbitrary.html' },
    {},
  ])('rejects a page or unrecognized sender without reading storage', async sender => {
    const { listener, get } = await background();
    const respond = vi.fn();
    listener({ type: 'checkout:clear' }, sender, respond);
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['local', 'session'] as const)('does not read wallet data when %s trusted-storage initialization fails', async area => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { listener, get } = await background(area);
    const respond = vi.fn();
    listener({ type: 'checkout:get-state' }, { id: 'our-extension', url: 'chrome-extension://our-extension/src/popup/index.html' }, respond);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith(expect.objectContaining({ ok: false })));
    expect(get).not.toHaveBeenCalled();
  });
});
