import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Popup from '../src/popup/Popup';
import ComparisonResult from '../src/components/ComparisonResult';
import { emptyState } from '../src/state/contracts';
import type { CheckoutResponse } from '../src/state/contracts';
import { cardIndex } from '../src/state/catalog-slice';
import { CATALOG_V3 } from '../src/domain';

/* Phase 15.4: the popup's copy while the install-time refresh is pending and the terms in effect have expired. */
const expired = { status: 'unavailable', reason: 'catalog-expired' } as const;
const view = (checkingTerms: boolean): CheckoutResponse => ({
  ok: true,
  state: {
    ...emptyState(),
    wallet: {
      defaultCardId: 'capital-one-quicksilver',
      cards: [{ cardId: 'capital-one-quicksilver', usage: [] }],
    },
  },
  catalog: CATALOG_V3,
  cardIndex: cardIndex(CATALOG_V3),
  comparison: expired,
  notice: null,
  catalogUpdatesAvailable: true,
  checkingTerms,
});
let listeners: Set<(message: unknown) => void>;
let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  listeners = new Set();
  send = vi.fn(async (request: { type: string }) =>
    request.type.startsWith('settings:')
      ? { ok: true, settings: { schemaVersion: 1, showOnOtherStores: true, disabledSites: [] } }
      : view(
          send.mock.calls.filter(([r]) => (r as { type: string }).type === 'checkout:get-state').length === 1,
        ),
  );
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: send,
      onMessage: {
        addListener: (listener: (message: unknown) => void) => listeners.add(listener),
        removeListener: (listener: (message: unknown) => void) => listeners.delete(listener),
      },
    },
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: { query: vi.fn(async () => []) },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('"Checking for updated terms…" (Phase 15.4)', () => {
  it('the popup says so instead of "expired" while the refresh is pending, and reloads when it settles', async () => {
    render(<Popup />);
    // The first load answers with the refresh pending; the saved comparison is "expired" to the engine.
    expect(await screen.findAllByText(/Checking for updated terms…/)).toHaveLength(2);
    expect(screen.queryByText(/These card terms have expired/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // The worker says the check settled (here: without new terms); the popup reloads and shows the expiry.
    await act(async () => {
      for (const listener of listeners) listener({ type: 'terms:checked' });
    });
    expect(await screen.findByText(/Card terms expire/)).toBeTruthy();
    expect(screen.queryByText(/Checking for updated terms…/)).toBeNull();
  });
  it('a broadcast that lands before the "Checking…" answer is rendered is not lost', async () => {
    // The refresh settles while the popup's first request is still in flight: the worker answered "checking"
    // but the broadcast reaches the page before that answer is rendered.
    let answer!: () => void;
    const first = new Promise<void>((resolve) => (answer = resolve));
    const inner = send.getMockImplementation() as (request: { type: string }) => Promise<unknown>;
    send.mockImplementation(async (request: { type: string }) => {
      const reply = await inner(request);
      if (
        request.type === 'checkout:get-state' &&
        (reply as CheckoutResponse & { checkingTerms?: boolean }).checkingTerms
      )
        await first;
      return reply;
    });
    render(<Popup />);
    await vi.waitFor(() => expect(listeners.size).toBeGreaterThan(0));
    await act(async () => {
      for (const listener of listeners) listener({ type: 'terms:checked' });
    });
    await act(async () => answer());
    expect(await screen.findByText(/Card terms expire/)).toBeTruthy();
    expect(screen.queryByText(/Checking for updated terms…/)).toBeNull();
  });
  it('the comparison result shows the expired copy, with "Check for updated terms", once no refresh is pending', () => {
    render(<ComparisonResult catalog={CATALOG_V3} result={expired} purchase={null} />);
    expect(screen.getByRole('alert').textContent).toContain('Check for updated terms');
  });
});
