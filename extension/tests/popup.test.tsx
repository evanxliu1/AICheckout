import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStateService } from '../src/state/service';
import { emptyState } from '../src/state/contracts';
import Popup from '../src/popup/Popup';
import type { AppState, CatalogCache } from '../src/state/contracts';
import { CATALOG_V3, PILOT_CATALOG } from '../src/domain';
import WalletEditor from '../src/components/WalletEditor';

let data: Record<string, unknown>;
const read = vi.fn();
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  // 15:00 UTC on the day the bundled catalog v3 was verified. Only the clock is faked (timers stay real);
  // the popup's stale-result timer takes midnight from `new Date()`, so that is faked too.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(CATALOG_V3.verifiedAt) + 15 * 60 * 60 * 1000);
  data = {
    checkoutStateV1: {
      ...emptyState(),
      wallet: {
        defaultCardId: 'capital-one-quicksilver',
        cards: [{ cardId: 'capital-one-quicksilver', usage: [] }],
      },
    },
  };
  read.mockReset();
  const handle = createStateService(
    {
      get: async () => structuredClone(data),
      set: async (value) => {
        Object.assign(data, structuredClone(value));
      },
      remove: async (keys) => {
        keys.forEach((k) => delete data[k]);
      },
      clear: async () => {
        data = {};
      },
    },
    Date.now,
    { read, validate: async () => undefined },
  );
  vi.stubGlobal('chrome', {
    runtime: {
      // Settings go to the badge service in the worker; the rest to the state service.
      sendMessage: vi.fn((request: { type: string }) =>
        request.type.startsWith('settings:')
          ? Promise.resolve({ ok: true, settings: { schemaVersion: 1, disabledMerchants: [] } })
          : handle(request),
      ),
    },
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function fillPurchase() {
  const input = await screen.findByLabelText('Purchase amount (USD)');
  fireEvent.change(input, { target: { value: '100' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I confirmed the amount/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare my cards' }));
}
/** The tab the popup opens on (the URL `activeTab` grants). */
function openOn(url: string) {
  (globalThis.chrome as unknown as { tabs: unknown }).tabs = {
    query: vi.fn(async () => [{ id: 3, url }]),
  };
}
const merchantValue = () => (screen.getByLabelText('Merchant') as HTMLSelectElement).value;
describe('popup store from the open tab', () => {
  it('preselects a supported store by its host', async () => {
    openOn('https://www.newegg.com/p/N82E1');
    render(<Popup />);
    await screen.findByLabelText('Purchase amount (USD)');
    await vi.waitFor(() => expect(merchantValue()).toBe('newegg-us'));
    expect(screen.getByRole('button', { name: 'Read cart amount' })).toBeTruthy();
  });
  it('preselects another U.S. online store for any other web page and compares a typed amount', async () => {
    openOn('https://shop.example.com/checkout');
    render(<Popup />);
    await screen.findByLabelText('Purchase amount (USD)');
    await vi.waitFor(() => expect(merchantValue()).toBe('generic-us-online'));
    expect(screen.queryByRole('button', { name: 'Read cart amount' })).toBeNull();
    expect(screen.queryByText(/do not cover/)).toBeNull();
    expect((screen.getByLabelText('Online retail bonus eligibility') as HTMLSelectElement).value).toBe(
      'eligible',
    );
    await fillPurchase();
    expect(
      await screen.findByText('Saved estimate for a $100.00 Another U.S. online store purchase.'),
    ).toBeTruthy();
    expect(screen.getByText('$1.50')).toBeTruthy();
    expect((data.checkoutStateV1 as AppState).purchase?.merchantId).toBe('generic-us-online');
    // Reopened on a non-web page, the saved generic purchase is restored.
    cleanup();
    openOn('chrome://newtab/');
    render(<Popup />);
    expect(
      await screen.findByText('Saved estimate for a $100.00 Another U.S. online store purchase.'),
    ).toBeTruthy();
    expect(merchantValue()).toBe('generic-us-online');
    expect((screen.getByLabelText('Purchase amount (USD)') as HTMLInputElement).value).toBe('100.00');
  });
  it('keeps the saved store on a non-web page', async () => {
    openOn('chrome://extensions/');
    render(<Popup />);
    await screen.findByLabelText('Purchase amount (USD)');
    expect(merchantValue()).toBe('best-buy-us');
  });
  it('offers another U.S. online store in the merchant select', async () => {
    render(<Popup />);
    await screen.findByLabelText('Purchase amount (USD)');
    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'generic-us-online' } });
    expect(screen.queryByRole('button', { name: 'Read cart amount' })).toBeNull();
    expect(screen.getByText(/Type the amount you will pay/)).toBeTruthy();
  });
});
describe('offline comparison popup', () => {
  it('changes manual merchant without carrying the old amount, confirmation or result across', async () => {
    render(<Popup />);
    await fillPurchase();
    await screen.findByText('$1.50');
    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'newegg-us' } });
    expect((screen.getByLabelText('Purchase amount (USD)') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('checkbox', { name: /I confirmed/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText('$1.50')).toBeNull();
    await fillPurchase();
    expect(await screen.findByText('Saved estimate for a $100.00 Newegg US purchase.')).toBeTruthy();
    expect((data.checkoutStateV1 as AppState).purchase?.merchantId).toBe('newegg-us');
    cleanup();
    render(<Popup />);
    expect(await screen.findByText('Saved estimate for a $100.00 Newegg US purchase.')).toBeTruthy();
    expect((screen.getByLabelText('Merchant') as HTMLSelectElement).value).toBe('newegg-us');
  });
  it('selects the captured merchant and keeps subtotal-only status visible in the saved estimate', async () => {
    read.mockResolvedValue({
      id: '6b89a362-0be9-4dca-990d-7e110e7f91ea',
      capturedAt: Date.now(),
      tabId: 7,
      documentId: 'doc-1',
      pageKey: 'a'.repeat(64),
      merchantId: 'newegg-us',
      currency: 'USD',
      amountCents: 24999,
      kind: 'subtotal',
      extractorVersion: 'newegg-summary-v1',
    });
    render(<Popup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Read cart amount' }));
    expect(await screen.findByText(/The final charge is not known/)).toBeTruthy();
    expect((screen.getByLabelText('Merchant') as HTMLSelectElement).value).toBe('newegg-us');
    expect((screen.getByLabelText('Purchase amount (USD)') as HTMLInputElement).value).toBe('249.99');
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirmed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare my cards' }));
    expect(await screen.findByText('Saved estimate for a $249.99 Newegg US subtotal.')).toBeTruthy();
    expect(screen.getByText(/Subtotal only; tax and shipping/)).toBeTruthy();
    cleanup();
    render(<Popup />);
    expect(await screen.findByText('Saved estimate for a $249.99 Newegg US subtotal.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Purchase amount (USD)'), { target: { value: '260' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirmed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare my cards' }));
    expect(await screen.findByText('Saved estimate for a $260.00 Newegg US purchase.')).toBeTruthy();
    expect(screen.queryByText(/Subtotal only; tax and shipping/)).toBeNull();
  });
  it('does not silently expand the scope of a newer downloaded catalog', async () => {
    // Newer than the bundled catalog and valid, so it stays in effect (newest valid catalog wins).
    const catalog = {
      ...PILOT_CATALOG,
      version: 'newer-published',
      verifiedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      merchantIds: ['best-buy-us'],
    };
    data.checkoutCatalogV1 = {
      lastCheckedAt: Date.now(),
      release: {
        sequence: 1,
        version: catalog.version,
        catalog,
        catalog_hash: 'a'.repeat(64),
        published_at: catalog.verifiedAt,
      },
    } satisfies CatalogCache;
    render(<Popup />);
    fireEvent.change(await screen.findByLabelText('Merchant'), { target: { value: 'newegg-us' } });
    expect(screen.getByText(/Your current card terms do not cover Newegg US/)).toBeTruthy();
    await fillPurchase();
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('These card terms do not cover this merchant'),
    );
    expect((data.checkoutStateV1 as AppState).comparison).toBeNull();
  });
  it('compares without an API key and hides the old estimate when inputs change', async () => {
    render(<Popup />);
    await fillPurchase();
    expect(await screen.findByRole('heading', { name: 'Your card estimate' })).toBeTruthy();
    expect(screen.getByText('$1.50')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Purchase amount (USD)'), { target: { value: '200' } });
    expect(screen.queryByText('$1.50')).toBeNull();
    expect((screen.getByRole('checkbox', { name: /I confirmed/ }) as HTMLInputElement).checked).toBe(false);
  });
  it('requires confirmation and keeps the compare action usable after an input error', async () => {
    render(<Popup />);
    const input = await screen.findByLabelText('Purchase amount (USD)');
    fireEvent.change(input, { target: { value: '1e3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare my cards' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fillPurchase();
    expect(await screen.findByText('$1.50')).toBeTruthy();
  });
  it('recovers from a disconnected worker', async () => {
    const send = vi.mocked(chrome.runtime.sendMessage);
    const original = send.getMockImplementation()!;
    let failed = false;
    send.mockImplementation(((request: { type: string }) => {
      if (!failed && request.type === 'checkout:get-state') {
        failed = true;
        return Promise.reject(new Error('disconnected'));
      }
      return (original as (r: unknown) => unknown)(request);
    }) as never);
    render(<Popup />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reload saved inputs' }));
    expect(await screen.findByLabelText('Purchase amount (USD)')).toBeTruthy();
  });
  it('deletes both stored data and displayed estimates', async () => {
    render(<Popup />);
    await fillPurchase();
    await screen.findByText('$1.50');
    fireEvent.click(screen.getByText('Delete saved data'));
    fireEvent.click(screen.getByRole('checkbox', { name: /I want to permanently delete/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete all local data' }));
    expect(await screen.findByRole('button', { name: 'Save cards' })).toBeTruthy();
    expect(screen.queryByText('$1.50')).toBeNull();
    expect(data).toEqual({});
  });
});

describe('wallet editor with the bundled catalog v3', () => {
  it('finds real cards by part of a name and stops at 20 cards', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(
      <WalletEditor
        catalog={CATALOG_V3}
        wallet={{ defaultCardId: null, cards: [] }}
        busy={false}
        onSave={onSave}
      />,
    );
    const search = screen.getByRole('combobox', { name: 'Add a card' });
    expect(screen.getByText(new RegExp(`\\(${CATALOG_V3.cards.length} cards\\)`))).toBeTruthy();
    await user.click(search);
    await user.paste('double cash');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('Citi Double Cash');
    await user.keyboard('{Escape}{Escape}');
    // Twenty cards in catalog order, picked through the search field.
    for (const card of CATALOG_V3.cards.slice(0, 20)) {
      await user.click(search);
      await user.paste(card.name);
      await user.click(screen.getByRole('option', { name: card.name }));
    }
    expect((search as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('You can save up to 20 cards. Remove one to add another.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save cards' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0] as unknown as [{ cards: unknown[] }])[0].cards).toHaveLength(20);
  }, 30_000);
});
