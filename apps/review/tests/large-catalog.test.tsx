import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG_V2, catalogSchema, type CatalogV3 } from '@ai-checkout/rewards-core';
import { CATALOG_V3_FIXTURE } from '../../../packages/rewards-core/test-cases.ts';
import { DraftPanel } from '../src/ReviewWorkspace';
import StartDraft from '../src/StartDraft';
import { bundledCatalogs } from '../src/bundled';
import { sha256 } from '../src/manifest';
import { reviewFixture } from './fixtures';
import { largeCatalogV3 } from '../../../packages/rewards-core/large-catalog-fixture.ts';

// The real manifests hold only corpus source IDs; these tests give the synthetic sources hashes.
const manifest = vi.hoisted(() => new Map<string, string>());
vi.mock('../src/manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/manifest')>();
  return {
    ...actual,
    manifestHash: (id: string) => manifest.get(id),
    manifestComparison: (id: string, hash: string | undefined) => {
      const expected = manifest.get(id);
      if (!expected || !hash) return undefined;
      return expected === hash ? 'matches' : 'differs';
    },
  };
});

const DAY = '2026-10-02';
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(`${DAY}T12:00:00Z`));
  manifest.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const setup = () => userEvent.setup({ delay: null });
const text = () => document.body.textContent ?? '';
function byText<T extends HTMLElement>(selector: string, name: string | RegExp) {
  const matches = [...document.querySelectorAll<T>(selector)].filter((node) => {
    const value = (node.textContent ?? '').trim();
    return typeof name === 'string' ? value === name : name.test(value);
  });
  if (matches.length !== 1)
    throw new Error(`Expected one ${selector} named ${name}, found ${matches.length}`);
  return matches[0];
}
const button = (name: string | RegExp) => byText<HTMLButtonElement>('button', name);
const summary = (name: string | RegExp) => byText('summary', name);
const control = <T extends HTMLElement = HTMLInputElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`No control #${id}`);
  return node as unknown as T;
};

/** A 180-card, 340-source v3 draft with nothing captured. */
function largeDraft() {
  const detail = reviewFixture(largeCatalogV3({ day: DAY }));
  detail.sources = [];
  detail.draft.source_document_ids = [];
  return detail;
}
function panel(detail = largeDraft()) {
  const handlers = {
    onDirty: vi.fn(),
    onUpdate: vi.fn(async () => {}),
    onCapture: vi.fn(async () => {}),
    onCaptureMany: vi.fn(async () => {}),
    onPublish: vi.fn(async () => {}),
    onLoadSource: vi.fn(),
  };
  render(<DraftPanel detail={detail} busy={false} {...handlers} />);
  return handlers;
}

it('offers the bundled catalog v3 first once the package exports it, and skips an invalid one', () => {
  expect(bundledCatalogs({ CATALOG_V2 }).map((catalog) => catalog.version)).toEqual([CATALOG_V2.version]);
  expect(
    bundledCatalogs({ CATALOG_V2, CATALOG_V3: CATALOG_V3_FIXTURE }).map((catalog) => catalog.schemaVersion),
  ).toEqual([3, 2]);
  expect(bundledCatalogs({ CATALOG_V2, CATALOG_V3: { schemaVersion: 3 } })).toHaveLength(1);
  // The real package exports both since Stage 2 M5, the 178-card catalog v3 first.
  expect(bundledCatalogs().map((catalog) => catalog.version)).toEqual([
    '2026-10-02.expansion.1',
    CATALOG_V2.version,
  ]);
});

it('starts a draft from the bundled v3 catalog, chosen by default while it is valid', async () => {
  const onCreate = vi.fn(async () => {});
  render(
    <StartDraft
      bundled={[CATALOG_V3_FIXTURE, CATALOG_V2]}
      head={1}
      busy={false}
      now={Date.now()}
      onCreate={onCreate}
    />,
  );
  const user = setup();
  const v3 = screen.getByLabelText(
    `Bundled catalog ${CATALOG_V3_FIXTURE.version} (schema 3, ${CATALOG_V3_FIXTURE.cards.length} cards)`,
  ) as HTMLInputElement;
  expect(v3.checked).toBe(true);
  expect(screen.getByText('Valid now')).toBeTruthy();
  expect(screen.getByText(`${CATALOG_V3_FIXTURE.cards.length} (3 sources to capture)`)).toBeTruthy();
  await user.click(button('Create draft'));
  await user.click(await screen.findByRole('button', { name: 'Create the draft' }));
  expect(onCreate).toHaveBeenCalledExactlyOnceWith(CATALOG_V3_FIXTURE);
  // The v2 catalog expired on 2026-10-29; at this date it is still offered and valid.
  await user.click(screen.getByLabelText(/^Bundled catalog 2026-09-29\.real\.1/));
  expect(screen.getByText(CATALOG_V2.version)).toBeTruthy();
});

it('groups a large diff by card with a search, and renders a section only when opened', async () => {
  panel();
  const user = setup();
  expect(document.querySelectorAll('.changes-table')).toHaveLength(0);
  expect(text()).toMatch(/[\d,]+ changed fields in 186 sections/);
  fireEvent.change(control('changes-search'), { target: { value: 'Synthetic Card 042' } });
  expect(text()).toContain('1 of 186 sections match.');
  await user.click(summary(/^Synthetic Card 042 \(\d+ changed fields\)$/));
  const table = document.querySelector('.changes-table')!;
  expect(table.textContent).toContain('Card 042 · c042-brand · Only at brands');
  expect(table.textContent).toContain('Card 042 · c042-paypal · Only when paying with');
  fireEvent.change(control('changes-search'), { target: { value: 'Reward programs' } });
  expect(text()).toContain('1 of 186 sections match.');
});

it('lists 340 sources with a search and loads a whole capture folder, refusing files that differ', async () => {
  const detail = largeDraft();
  const sources = detail.draft.catalog.sources;
  manifest.set(sources[0].id, (await sha256(`Terms for ${sources[0].id}`))!);
  manifest.set(sources[1].id, 'f'.repeat(64));
  const handlers = panel(detail),
    user = setup();
  expect(text()).toContain('0 of 340 sources have matching captured evidence.');
  fireEvent.change(control('source-search'), { target: { value: 'large-source-007' } });
  expect(text()).toContain('1 of 340 sources match.');
  await user.click(summary('Capture all missing sources'));
  // Too many for a paste field each: the folder or files are the way in.
  expect(document.getElementById(`capture-${sources[0].id}`)).toBeNull();
  const files = [
    ...sources
      .slice(0, 339)
      .map((source) => new File([`Terms for ${source.id}`], `${source.id}.txt`, { type: 'text/plain' })),
    new File(['{}'], 'manifest.json', { type: 'application/json' }),
    new File(['other'], 'unrelated-source.txt', { type: 'text/plain' }),
  ];
  const folder = control('capture-folder');
  expect(folder.hasAttribute('webkitdirectory')).toBe(true);
  await user.upload(folder, files);
  await waitFor(() =>
    expect(text()).toMatch(
      /Loaded 338 files; ignored 1 that match no missing source \(unrelated-source\.txt\); skipped 1 that are not \.txt files\. Refused 1 whose SHA-256 differs from the corpus manifest \(large-source-002\.txt\)/,
    ),
  );
  expect(text()).toContain('1 of 338 matches a corpus manifest; 337 are not in one.');
  expect(text()).toContain('338 of 340 missing sources have text loaded.');
  await user.click(summary('Sources still without text (2)'));
  expect(text()).toContain('large-source-002');
  expect(text()).toContain('large-source-340');
  await user.click(button('Capture 338 of 340 missing sources and attach'));
  const [items] = handlers.onCaptureMany.mock.calls[0] as unknown as [{ sourceKey: string; body: string }[]];
  expect(items).toHaveLength(338);
  expect(items[0]).toEqual({ sourceKey: sources[0].id, body: `Terms for ${sources[0].id}` });
  expect(items.some((item) => item.sourceKey === sources[1].id)).toBe(false);
  await user.click(button('Clear loaded files'));
  expect(text()).toContain('0 of 340 missing sources have text loaded.');
});

it('edits a v3 card found by search: program value, brand scope, payment path and dates', async () => {
  const detail = largeDraft();
  const handlers = panel(detail),
    user = setup();
  await user.click(summary('Correct draft data'));
  expect(document.querySelectorAll('.editor-card')).toHaveLength(180);
  // Collapsed cards render no fields.
  expect(document.querySelectorAll('.editor-card input')).toHaveLength(0);
  fireEvent.change(control('editor-card-search'), { target: { value: 'card 007' } });
  expect(text()).toContain('1 of 180 cards match.');
  await user.click(summary('Synthetic Card 007'));
  const c = 6,
    card = (detail.draft.catalog as CatalogV3).cards[c];
  const brandRule = card.rules.findIndex((rule) => rule.id === 'c007-brand');
  const brands = control(`edit-cards-${c}-rules-${brandRule}-brandIds`);
  fireEvent.change(brands, { target: { value: 'brand-07, ' } });
  expect((brands as HTMLInputElement).value).toBe('brand-07, ');
  fireEvent.change(brands, { target: { value: 'brand-07, no-such-brand' } });
  expect(brands.getAttribute('aria-invalid')).toBe('true');
  expect(text()).toContain('Rule references an absent brand.');
  fireEvent.change(brands, { target: { value: 'brand-07, brand-08' } });
  const venmo = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (input) =>
      input.closest('.editor-rule')?.querySelector('legend')?.textContent?.startsWith('c007-brand') &&
      input.labels?.[0]?.textContent === 'venmo',
  )!;
  await user.click(venmo);
  const rotating = card.rules.findIndex((rule) => rule.id === 'c007-rotating');
  fireEvent.change(control(`edit-cards-${c}-rules-${rotating}-limitedTime-startsOn`), {
    target: { value: '2026-10-15' },
  });
  await user.click(summary('Reward programs and point values (31)'));
  fireEvent.change(control('edit-programs-1-valuation-valueHundredthsOfCent'), { target: { value: '140' } });
  const save = button('Save structured edits');
  expect(save.disabled).toBe(false);
  await user.click(save);
  const [saved] = handlers.onUpdate.mock.calls[0] as unknown as [CatalogV3];
  expect(catalogSchema.safeParse(saved).success).toBe(true);
  const rules = saved.cards[c].rules;
  expect(rules[brandRule].brandIds).toEqual(['brand-07', 'brand-08']);
  expect(rules[brandRule].requiredPaymentPaths).toEqual(['venmo']);
  expect(rules[rotating].limitedTime).toEqual({ startsOn: '2026-10-15', endsOn: '2026-10-31' });
  expect(saved.programs[1].valuation).toMatchObject({
    basis: 'published-estimate',
    valueHundredthsOfCent: 140,
  });
});
