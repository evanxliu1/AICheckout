// What pages receive of the catalog in effect (Stage 2 M7, coordinator request 2026-10-03): the owned
// cards' full terms and a compact index of every card, never the whole ~800 KB bundled catalog.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG_V3 } from '../src/domain';
import type { Catalog, Wallet } from '../src/domain';
import { emptyState, responseSchema } from '../src/state/contracts';
import type { CheckoutResponse } from '../src/state/contracts';
import { createStateService, STATE_KEY } from '../src/state/service';
import type { StateStorage } from '../src/state/service';
import { cardIndex, catalogSlice } from '../src/state/catalog-slice';
import WalletEditor from '../src/components/WalletEditor';
import { mergeSlices } from '../src/components/wallet-options';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const now = Date.parse('2026-10-15T15:00:00Z');
function memory(initial: Record<string, unknown> = {}): StateStorage {
  let data = structuredClone(initial);
  return {
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
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
}
function ok(result: unknown) {
  const response = result as CheckoutResponse;
  if (!response.ok) throw new Error(response.error);
  return response;
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

describe('page responses carry a catalog slice and a card index', () => {
  const wallet: Wallet = {
    defaultCardId: 'citi-double-cash',
    cards: [
      { cardId: 'citi-double-cash', usage: [] },
      { cardId: 'amex-blue-cash-everyday', usage: [] },
    ],
  };
  it('sends the owned cards’ terms, every merchant and an index of all cards', async () => {
    const service = createStateService(
      memory({ [STATE_KEY]: { ...emptyState(), wallet, walletCatalogVersion: CATALOG_V3.version } }),
      () => now,
    );
    const read = ok(await service({ type: 'checkout:get-state' }));
    expect(responseSchema.safeParse(read).success).toBe(true);
    expect(read.catalog.version).toBe(CATALOG_V3.version);
    expect(read.catalog.cards.map((c) => c.id).sort()).toEqual([
      'amex-blue-cash-everyday',
      'citi-double-cash',
    ]);
    expect(read.catalog.schemaVersion === 3 && read.catalog.merchants.length).toBe(
      CATALOG_V3.merchants.length,
    );
    expect(read.cardIndex).toHaveLength(CATALOG_V3.cards.length);
    expect(read.cardIndex.find((c) => c.id === 'citi-double-cash')).toEqual({
      id: 'citi-double-cash',
      name: 'Citi Double Cash',
      shortName: 'Double Cash',
      issuer: 'Citi',
    });
    // The bundled catalog is about 800 KB; a response with two cards is a small fraction of it.
    expect(bytes(CATALOG_V3)).toBeGreaterThan(600_000);
    expect(bytes(read)).toBeLessThan(80_000);
    expect(bytes(read.cardIndex)).toBeLessThan(30_000);
  });

  it('adds the terms of the cards a page asks for, read-only', async () => {
    const storage = memory({
      [STATE_KEY]: { ...emptyState(), wallet, walletCatalogVersion: CATALOG_V3.version },
    });
    const service = createStateService(storage, () => now);
    const more = ok(
      await service({ type: 'checkout:catalog-cards', cardIds: ['citi-double-cash', 'us-bank-cash-plus'] }),
    );
    expect(more.catalog.cards.map((c) => c.id).sort()).toEqual([
      'amex-blue-cash-everyday',
      'citi-double-cash',
      'us-bank-cash-plus',
    ]);
    expect(more.state.revision).toBe(0);
    expect(await service({ type: 'checkout:catalog-cards', cardIds: Array(21).fill('x') })).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });

  it('cuts a v3 catalog to what its cards refer to, and merges slices of the same catalog', () => {
    const slice = catalogSlice(CATALOG_V3, ['prime-visa']);
    if (slice.schemaVersion !== 3) throw new Error('v3');
    expect(slice.cards.map((c) => c.id)).toEqual(['prime-visa']);
    expect(slice.gates.map((g) => g.id)).toContain('amazon-prime');
    expect(slice.programs.map((p) => p.id)).toEqual([slice.cards[0].programId]);
    const merged = mergeSlices(slice, catalogSlice(CATALOG_V3, ['citi-double-cash']));
    expect(merged.cards.map((c) => c.id)).toEqual(['prime-visa', 'citi-double-cash']);
    expect(catalogSlice(CATALOG_V3, []).cards).toEqual([]);
    expect(cardIndex(CATALOG_V3)).toHaveLength(CATALOG_V3.cards.length);
  });
});

describe('wallet editor over a slice', () => {
  it('loads an added card’s terms before asking its questions, and waits for them to save', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    let release: (catalog: Catalog) => void = () => {};
    const loadCards = vi.fn(
      (ids: string[]) =>
        new Promise<Catalog>((resolve) => {
          release = () => resolve(catalogSlice(CATALOG_V3, ids));
        }),
    );
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <WalletEditor
        catalog={catalogSlice(CATALOG_V3, [])}
        index={cardIndex(CATALOG_V3)}
        loadCards={loadCards}
        wallet={{ defaultCardId: null, cards: [] }}
        busy={false}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Add a card' }));
    await user.paste('prime visa');
    await user.click(screen.getByRole('option', { name: 'Prime Visa' }));
    expect(loadCards).toHaveBeenCalledWith(['prime-visa']);
    expect(screen.getByText('Chase · loading its terms…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'About you' })).toBeNull();
    release(CATALOG_V3);
    expect(
      await screen.findByRole('group', { name: 'Do you have an eligible Amazon Prime membership?' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save cards' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
