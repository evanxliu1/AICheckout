import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftPanel } from '../src/ReviewWorkspace';
import { CATALOG_V2 } from '@ai-checkout/rewards-core';
import { reviewFixture, now } from './fixtures';

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function panel(detail = reviewFixture()) {
  const handlers = {
    onDirty: vi.fn(),
    onUpdate: vi.fn(async () => {}),
    onCapture: vi.fn(async () => {}),
    onCaptureMany: vi.fn(async () => {}),
    onPublish: vi.fn(async () => {}),
  };
  render(<DraftPanel detail={detail} busy={false} {...handlers} />);
  return handlers;
}
it('requires the explicit review acknowledgement and note even for an implicit form submit', async () => {
  const handlers = panel(),
    user = userEvent.setup();
  const publish = screen.getByRole('button', { name: 'Publish reviewed terms' });
  expect((publish as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(publish.closest('form')!);
  expect(handlers.onPublish).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox'));
  await user.type(screen.getByLabelText('Review note'), 'Checked all synthetic source terms.');
  await user.click(publish);
  // A confirmation dialog opens with focus on the safe action; only its Publish release publishes.
  const dialog = await screen.findByRole('dialog', { name: /Publish/ });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  expect(handlers.onPublish).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Publish release' }));
  expect(dialog.isConnected).toBe(false);
  expect(handlers.onPublish).toHaveBeenCalledExactlyOnceWith('Checked all synthetic source terms.');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});
it('renders hostile source text as text, without executing or rendering embedded HTML', () => {
  panel();
  expect(screen.getAllByText(/Synthetic test evidence/)).toHaveLength(3);
  expect(document.querySelector('img')).toBeNull();
});
it('makes unsaved edits block publication and discarding them restores the exact saved revision', async () => {
  const handlers = panel(),
    user = userEvent.setup();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByText('Correct draft data'));
  fireEvent.change(screen.getByLabelText('Catalog JSON'), { target: { value: '{}' } });
  expect(handlers.onDirty).toHaveBeenLastCalledWith(true);
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Discard edits' }));
  expect(handlers.onDirty).toHaveBeenLastCalledWith(false);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});
it('keeps incomplete evidence visible and prevents approval', () => {
  const detail = reviewFixture();
  detail.sources = [];
  detail.draft.source_document_ids = [];
  panel(detail);
  expect(screen.getAllByText('Matching evidence needed')).toHaveLength(3);
  expect((screen.getByRole('button', { name: 'Publish reviewed terms' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it('summarizes v2 rules and validates v2 JSON edits with the schema union', async () => {
  const detail = reviewFixture();
  const v2 = structuredClone(CATALOG_V2);
  detail.draft.catalog = v2;
  const handlers = panel(detail),
    user = userEvent.setup();
  expect(screen.getAllByText(/1% is paid when the balance is paid\./)).toHaveLength(2);
  expect(screen.getAllByText(/Excludes bnpl\./)).toHaveLength(1);
  await user.click(screen.getByText('Correct draft data'));
  await user.click(screen.getByRole('tab', { name: 'JSON' }));
  const broken = structuredClone(v2);
  broken.cards[0].rules[0].paidOnPaymentBps = 900;
  fireEvent.change(screen.getByLabelText('Catalog JSON'), { target: { value: JSON.stringify(broken) } });
  await user.click(screen.getByRole('button', { name: 'Save draft revision' }));
  expect(await screen.findByText(/paid-on-payment portion cannot exceed the rate/)).toBeTruthy();
  expect(handlers.onUpdate).not.toHaveBeenCalled();
  const edited = structuredClone(v2);
  edited.version = '2026-10-01.real.2';
  fireEvent.change(screen.getByLabelText('Catalog JSON'), { target: { value: JSON.stringify(edited) } });
  await user.click(screen.getByRole('button', { name: 'Save draft revision' }));
  expect(handlers.onUpdate).toHaveBeenCalledWith(edited, null);
});

it('edits a v2 rule field by field with live schema validation and saves one revision', async () => {
  const detail = reviewFixture();
  detail.draft.catalog = structuredClone(CATALOG_V2);
  const handlers = panel(detail),
    user = userEvent.setup();
  await user.click(screen.getByText('Correct draft data'));
  expect(screen.getByRole('tab', { name: 'Cards and rules', selected: true })).toBeTruthy();
  await user.click(screen.getByText('Citi Double Cash', { selector: '.editor-card .ac-disclosure__title' }));
  const paid = screen.getByLabelText('Paid when balance is paid (bps)', {
    selector: '#edit-cards-0-rules-0-paidOnPaymentBps',
  });
  fireEvent.change(paid, { target: { value: '300' } });
  expect(paid.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getAllByText(/paid-on-payment portion cannot exceed the rate/).length).toBeGreaterThan(0);
  const save = screen.getByRole('button', { name: 'Save structured edits' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(paid, { target: { value: '50' } });
  expect(save.disabled).toBe(false);
  expect(screen.getByText('1 field edited since the saved revision.')).toBeTruthy();
  expect(handlers.onDirty).toHaveBeenLastCalledWith(true);
  await user.click(save);
  const saved = handlers.onUpdate.mock.calls[0] as unknown as [typeof CATALOG_V2, null];
  expect(saved[0].cards[0].rules[0].paidOnPaymentBps).toBe(50);
  expect(saved[1]).toBeNull();
});
it('captures every missing source in one step from loaded files', async () => {
  const detail = reviewFixture();
  detail.sources = detail.sources.slice(0, 1);
  detail.draft.source_document_ids = [detail.sources[0].id];
  const onCaptureMany = vi.fn(async () => {});
  render(
    <DraftPanel
      detail={detail}
      busy={false}
      onDirty={vi.fn()}
      onUpdate={vi.fn(async () => {})}
      onCapture={vi.fn(async () => {})}
      onCaptureMany={onCaptureMany}
      onPublish={vi.fn(async () => {})}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText('Capture all missing sources'));
  const missing = detail.draft.catalog.sources.slice(1);
  const files = [
    ...missing.map(
      (source) => new File([`Terms for ${source.id}`], `${source.id}.txt`, { type: 'text/plain' }),
    ),
    new File(['ignored'], 'other.txt', { type: 'text/plain' }),
  ];
  await user.upload(screen.getByLabelText('Load capture files'), files);
  expect(await screen.findByText(/Loaded 2 files; ignored 1/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Capture 2 of 2 missing sources and attach' }));
  expect(onCaptureMany).toHaveBeenCalledWith(
    missing.map((source) => ({ sourceKey: source.id, body: `Terms for ${source.id}` })),
  );
});

/** The real v2 catalog with no source captured yet. */
function v2Detail() {
  const detail = reviewFixture();
  detail.draft.catalog = structuredClone(CATALOG_V2);
  detail.sources = [];
  detail.draft.source_document_ids = [];
  return detail;
}
async function openCiti(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Correct draft data'));
  await user.click(screen.getByText('Citi Double Cash', { selector: '.editor-card .ac-disclosure__title' }));
}
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

it('blocks both capture actions, with a reason, while structured or JSON edits are unsaved', async () => {
  const handlers = panel(v2Detail()),
    user = userEvent.setup();
  await openCiti(user);
  fireEvent.change(screen.getByLabelText('Rate (bps)', { selector: '#edit-cards-0-rules-0-rateBps' }), {
    target: { value: '210' },
  });
  await user.click(screen.getByText('Capture all missing sources'));
  fireEvent.change(screen.getAllByRole('textbox', { name: /\(citi-double-cash-product\)/ })[0], {
    target: { value: 'Pasted terms' },
  });
  const many = button(/^Capture 1 of \d+ missing sources and attach$/);
  expect(many.disabled).toBe(true);
  expect(many.getAttribute('aria-describedby')).toBe('capture-many-blocked');
  expect(document.getElementById('capture-many-blocked')!.textContent).toMatch(
    /Save or discard the unsaved input in the Cards and rules editor first/,
  );
  await user.click(screen.getByText('Capture source evidence'));
  fireEvent.change(screen.getByLabelText('Text from the source'), { target: { value: 'More terms' } });
  const single = button('Capture and attach evidence');
  expect(single.disabled).toBe(true);
  expect(document.getElementById('capture-blocked')!.textContent).toMatch(/Cards and rules editor/);
  fireEvent.submit(single.closest('form')!);
  expect(handlers.onCapture).not.toHaveBeenCalled();
  expect(handlers.onCaptureMany).not.toHaveBeenCalled();

  // Discarding the structured edits is not enough while the other capture still has text.
  await user.click(button('Discard structured edits'));
  expect(button(/^Capture 1 of/).disabled).toBe(true);
  await user.click(button('Discard unsaved source text'));
  expect(button(/^Capture 1 of/).disabled).toBe(false);

  // JSON edits block captures the same way.
  await user.click(screen.getByRole('tab', { name: 'JSON' }));
  const json = screen.getByLabelText('Catalog JSON') as HTMLTextAreaElement;
  fireEvent.change(json, { target: { value: json.value.replace('"version": "', '"version": "x') } });
  expect(button(/^Capture 1 of/).disabled).toBe(true);
  expect(document.getElementById('capture-many-blocked')!.textContent).toMatch(/the JSON editor/);
});

it('blocks saving draft edits, with a reason, while capture text is loaded', async () => {
  const handlers = panel(v2Detail()),
    user = userEvent.setup();
  await user.click(screen.getByText('Capture all missing sources'));
  await user.upload(screen.getByLabelText('Load capture files'), [
    new File(['Citi terms'], 'citi-double-cash-product.txt', { type: 'text/plain' }),
  ]);
  expect(await screen.findByText(/Loaded 1 file/)).toBeTruthy();
  await openCiti(user);
  fireEvent.change(screen.getByLabelText('Rate (bps)', { selector: '#edit-cards-0-rules-0-rateBps' }), {
    target: { value: '210' },
  });
  const save = button('Save structured edits');
  expect(save.disabled).toBe(true);
  expect(document.getElementById('structured-blocked')!.textContent).toMatch(
    /unsaved input in Capture all missing sources first/,
  );
  await user.click(save);
  expect(handlers.onUpdate).not.toHaveBeenCalled();

  await user.click(button('Discard structured edits'));
  await user.click(screen.getByRole('tab', { name: 'JSON' }));
  const json = screen.getByLabelText('Catalog JSON') as HTMLTextAreaElement;
  fireEvent.change(json, { target: { value: json.value.replace('"version": "', '"version": "x') } });
  const saveJson = button('Save draft revision');
  expect(saveJson.disabled).toBe(true);
  expect(document.getElementById('json-blocked')!.textContent).toMatch(/Capture all missing sources/);
  fireEvent.submit(saveJson.closest('form')!);
  expect(handlers.onUpdate).not.toHaveBeenCalled();
});

it('starts a new spend cap blank, so the reviewer must enter the issuer values', async () => {
  panel(v2Detail());
  const c = CATALOG_V2.cards.findIndex((card) => card.id === 'citi-double-cash');
  const r = CATALOG_V2.cards[c].rules.findIndex((rule) => rule.cap.kind !== 'spend');
  const user = userEvent.setup();
  await openCiti(user);
  fireEvent.change(screen.getByLabelText('Spend cap', { selector: `#edit-cards-${c}-rules-${r}-cap` }), {
    target: { value: 'spend' },
  });
  const amount = screen.getByLabelText('Cap amount (cents)') as HTMLInputElement;
  const period = screen.getByLabelText('Cap period') as HTMLSelectElement;
  const after = screen.getByLabelText('Rate after cap (bps)') as HTMLInputElement;
  expect([amount.value, period.value, after.value]).toEqual(['', '', '']);
  expect(amount.getAttribute('aria-invalid')).toBe('true');
  expect(after.getAttribute('aria-invalid')).toBe('true');
  expect(button('Save structured edits').disabled).toBe(true);
});

it('accepts digits only in numeric fields and never saves on Enter', async () => {
  const handlers = panel(v2Detail()),
    user = userEvent.setup();
  await openCiti(user);
  const rate = screen.getByLabelText('Rate (bps)', {
    selector: '#edit-cards-0-rules-0-rateBps',
  }) as HTMLInputElement;
  for (const value of ['0x10', '1e3', ' 200', '2.5', '-1']) {
    fireEvent.change(rate, { target: { value } });
    expect(rate.value).toBe(value);
    expect(rate.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByText('Enter a whole number using digits only.').length).toBeGreaterThan(0);
    expect(button('Save structured edits').disabled).toBe(true);
  }
  await user.clear(rate);
  await user.type(rate, '210{Enter}');
  expect(rate.getAttribute('aria-invalid')).toBeNull();
  expect(button('Save structured edits').disabled).toBe(false);
  expect(handlers.onUpdate).not.toHaveBeenCalled();
});

it('names the card for problems in a collapsed card and opens it to the field', async () => {
  panel(v2Detail());
  const user = userEvent.setup();
  await openCiti(user);
  fireEvent.change(
    screen.getByLabelText('Paid when balance is paid (bps)', {
      selector: '#edit-cards-0-rules-0-paidOnPaymentBps',
    }),
    { target: { value: '900' } },
  );
  await user.click(screen.getByText('Citi Double Cash', { selector: '.editor-card .ac-disclosure__title' }));
  const summary = screen.getByText(/problem to fix|problems to fix/).closest('.ac-alert')!;
  expect(summary.getAttribute('role')).toBeNull();
  expect(summary.textContent).toMatch(/Citi Double Cash · rule [a-z0-9-]+ · paidOnPaymentBps/);
  expect(summary.textContent).not.toMatch(/edit in JSON/);
  await user.click(screen.getByRole('button', { name: 'Open Citi Double Cash' }));
  await waitFor(() => expect(document.activeElement?.id).toBe('edit-cards-0-rules-0-paidOnPaymentBps'));
});

it('skips capture files too large to be a capture without reading them', async () => {
  panel(v2Detail());
  const user = userEvent.setup();
  await user.click(screen.getByText('Capture all missing sources'));
  const big = new File(['x'.repeat(480_001)], 'citi-double-cash-product.txt', { type: 'text/plain' });
  const read = vi.spyOn(big, 'text');
  await user.upload(screen.getByLabelText('Load capture files'), [big]);
  expect(await screen.findByText(/Loaded 0 files; skipped 1 too large to be a capture/)).toBeTruthy();
  expect(read).not.toHaveBeenCalled();
});
