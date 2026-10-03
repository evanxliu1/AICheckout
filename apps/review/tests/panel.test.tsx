import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftPanel } from '../src/ReviewWorkspace';
import { CATALOG_V2 } from '@ai-checkout/rewards-core';
import { reviewFixture, now, sourceDocument } from './fixtures';

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
// The v2 panel renders a large DOM; role queries walk the accessibility tree and are slow in
// jsdom, so controls are found by their text and typing runs without delays.
const setup = () => userEvent.setup({ delay: null });
function byText<T extends HTMLElement>(selector: string, name: string | RegExp) {
  const matches = [...document.querySelectorAll<T>(selector)].filter((node) => {
    const text = (node.textContent ?? '').trim();
    return typeof name === 'string' ? text === name : name.test(text);
  });
  if (matches.length !== 1)
    throw new Error(`Expected one ${selector} named ${name}, found ${matches.length}`);
  return matches[0];
}
const control = <T extends HTMLElement = HTMLInputElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`No control #${id}`);
  return node as unknown as T;
};
const summary = (name: string) => byText('summary', name);
const text = () => document.body.textContent ?? '';
const button = (name: string | RegExp) => byText<HTMLButtonElement>('button', name);
const tab = (name: string) => byText<HTMLButtonElement>('[role="tab"]', name);
function panel(detail = reviewFixture()) {
  const handlers = {
    onDirty: vi.fn(),
    onUpdate: vi.fn(async () => {}),
    onCapture: vi.fn(async () => {}),
    onCaptureMany: vi.fn(async () => {}),
    onPublish: vi.fn(async () => {}),
    onLoadSource: vi.fn(async (id: string) => sourceDocument(detail.sources.find((doc) => doc.id === id)!)),
  };
  render(<DraftPanel detail={detail} busy={false} {...handlers} />);
  return handlers;
}
it('requires the explicit review acknowledgement and note even for an implicit form submit', async () => {
  const handlers = panel(),
    user = setup();
  const publish = button('Publish reviewed terms');
  expect((publish as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(publish.closest('form')!);
  expect(handlers.onPublish).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox'));
  await user.type(screen.getByLabelText('Review note'), 'Checked all synthetic source terms.');
  await user.click(publish);
  // A confirmation dialog opens with focus on the safe action; only its Publish release publishes.
  const dialog = await screen.findByRole('dialog', { name: /Publish/ });
  expect(document.activeElement).toBe(button('Cancel'));
  expect(handlers.onPublish).not.toHaveBeenCalled();
  await user.click(button('Publish release'));
  expect(dialog.isConnected).toBe(false);
  expect(handlers.onPublish).toHaveBeenCalledExactlyOnceWith('Checked all synthetic source terms.');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});
it('loads each captured text when opened and renders hostile text as text, without executing HTML', async () => {
  const handlers = panel(),
    user = setup();
  expect(screen.queryAllByText(/Synthetic test evidence/)).toHaveLength(0);
  expect(handlers.onLoadSource).not.toHaveBeenCalled();
  for (const summary of document.querySelectorAll<HTMLElement>('.source-card summary'))
    await user.click(summary);
  await waitFor(() => expect(screen.getAllByText(/Synthetic test evidence/)).toHaveLength(3));
  expect(handlers.onLoadSource).toHaveBeenCalledTimes(3);
  expect(document.querySelector('img')).toBeNull();
  // Closing and reopening does not read the text again.
  const first = document.querySelector<HTMLElement>('.source-card summary')!;
  await user.click(first);
  await user.click(first);
  expect(handlers.onLoadSource).toHaveBeenCalledTimes(3);
});
it('reports a capture that cannot be loaded and retries when reopened', async () => {
  const detail = reviewFixture();
  const handlers = panel(detail),
    user = setup();
  handlers.onLoadSource.mockRejectedValueOnce(new Error('This capture is no longer attached to the draft.'));
  const first = document.querySelector<HTMLElement>('.source-card summary')!;
  await user.click(first);
  expect(await screen.findByText(/no longer attached to the draft\. Close and open/)).toBeTruthy();
  await user.click(first);
  await user.click(first);
  expect(await screen.findByText(/Synthetic test evidence/)).toBeTruthy();
  expect(handlers.onLoadSource).toHaveBeenCalledTimes(2);
});
it('makes unsaved edits block publication and discarding them restores the exact saved revision', async () => {
  const handlers = panel(),
    user = setup();
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByText('Correct draft data'));
  fireEvent.change(screen.getByLabelText('Catalog JSON'), { target: { value: '{}' } });
  expect(handlers.onDirty).toHaveBeenLastCalledWith(true);
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  await user.click(button('Discard edits'));
  expect(handlers.onDirty).toHaveBeenLastCalledWith(false);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});
it('keeps incomplete evidence visible and prevents approval', () => {
  const detail = reviewFixture();
  detail.sources = [];
  detail.draft.source_document_ids = [];
  panel(detail);
  expect(screen.getAllByText('Matching evidence needed')).toHaveLength(3);
  expect((button('Publish reviewed terms') as HTMLButtonElement).disabled).toBe(true);
});
it('summarizes v2 rules and validates v2 JSON edits with the schema union', async () => {
  const detail = reviewFixture();
  const v2 = structuredClone(CATALOG_V2);
  detail.draft.catalog = v2;
  const handlers = panel(detail),
    user = setup();
  await user.click(summary('All proposed card rules (7 cards)'));
  expect(screen.getAllByText(/1% is paid when the balance is paid\./)).toHaveLength(2);
  expect(screen.getAllByText(/Excludes bnpl\./)).toHaveLength(1);
  await user.click(summary('Correct draft data'));
  await user.click(tab('JSON'));
  const broken = structuredClone(v2);
  broken.cards[0].rules[0].paidOnPaymentBps = 900;
  fireEvent.change(control('catalog-json'), { target: { value: JSON.stringify(broken) } });
  await user.click(button('Save draft revision'));
  await waitFor(() => expect(text()).toMatch(/paid-on-payment portion cannot exceed the rate/));
  expect(handlers.onUpdate).not.toHaveBeenCalled();
  const edited = structuredClone(v2);
  edited.version = '2026-10-01.real.2';
  fireEvent.change(control('catalog-json'), { target: { value: JSON.stringify(edited) } });
  await user.click(button('Save draft revision'));
  expect(handlers.onUpdate).toHaveBeenCalledWith(edited, null);
});

it('edits a v2 rule field by field with live schema validation and saves one revision', async () => {
  const detail = reviewFixture();
  detail.draft.catalog = structuredClone(CATALOG_V2);
  const handlers = panel(detail),
    user = setup();
  await user.click(summary('Correct draft data'));
  expect(tab('Cards and rules').getAttribute('aria-selected')).toBe('true');
  await user.click(byText('.editor-card > summary', 'Citi Double Cash'));
  const paid = control('edit-cards-0-rules-0-paidOnPaymentBps');
  fireEvent.change(paid, { target: { value: '300' } });
  expect(paid.getAttribute('aria-invalid')).toBe('true');
  expect(text()).toMatch(/paid-on-payment portion cannot exceed the rate/);
  const save = button('Save structured edits') as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(paid, { target: { value: '50' } });
  expect(save.disabled).toBe(false);
  expect(text()).toContain('1 field edited since the saved revision.');
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
      onLoadSource={vi.fn()}
    />,
  );
  const user = setup();
  await user.click(summary('Capture all missing sources'));
  const missing = detail.draft.catalog.sources.slice(1);
  const files = [
    ...missing.map(
      (source) => new File([`Terms for ${source.id}`], `${source.id}.txt`, { type: 'text/plain' }),
    ),
    new File(['ignored'], 'other.txt', { type: 'text/plain' }),
  ];
  await user.upload(control('capture-files'), files);
  await waitFor(() => expect(text()).toMatch(/Loaded 2 files; ignored 1/));
  await user.click(button('Capture 2 of 2 missing sources and attach'));
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
  await user.click(summary('Correct draft data'));
  await user.click(byText('.editor-card > summary', 'Citi Double Cash'));
}

it('blocks both capture actions, with a reason, while structured or JSON edits are unsaved', async () => {
  const handlers = panel(v2Detail()),
    user = setup();
  await openCiti(user);
  fireEvent.change(control('edit-cards-0-rules-0-rateBps'), {
    target: { value: '210' },
  });
  await user.click(summary('Capture all missing sources'));
  fireEvent.change(control('capture-citi-double-cash-product'), {
    target: { value: 'Pasted terms' },
  });
  const many = button(/^Capture 1 of \d+ missing sources and attach$/);
  expect(many.disabled).toBe(true);
  expect(many.getAttribute('aria-describedby')).toBe('capture-many-blocked');
  expect(document.getElementById('capture-many-blocked')!.textContent).toMatch(
    /Save or discard the unsaved input in the Cards and rules editor first/,
  );
  await user.click(summary('Capture source evidence'));
  fireEvent.change(control('source-body'), { target: { value: 'More terms' } });
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
  await user.click(tab('JSON'));
  const json = control('catalog-json') as HTMLTextAreaElement;
  fireEvent.change(json, { target: { value: json.value.replace('"version": "', '"version": "x') } });
  expect(button(/^Capture 1 of/).disabled).toBe(true);
  expect(document.getElementById('capture-many-blocked')!.textContent).toMatch(/the JSON editor/);
});

it('blocks saving draft edits, with a reason, while capture text is loaded', async () => {
  const handlers = panel(v2Detail()),
    user = setup();
  await user.click(summary('Capture all missing sources'));
  fireEvent.change(control('capture-citi-double-cash-product'), { target: { value: 'Citi terms' } });
  await openCiti(user);
  fireEvent.change(control('edit-cards-0-rules-0-rateBps'), {
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
  await user.click(tab('JSON'));
  const json = control('catalog-json') as HTMLTextAreaElement;
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
  const user = setup();
  await openCiti(user);
  fireEvent.change(control(`edit-cards-${c}-rules-${r}-cap`), {
    target: { value: 'spend' },
  });
  const amount = control(`edit-cards-${c}-rules-${r}-cap-amountCents`) as HTMLInputElement;
  const period = control(`edit-cards-${c}-rules-${r}-cap-period`) as HTMLSelectElement;
  const after = control(`edit-cards-${c}-rules-${r}-cap-rateAfterCapBps`) as HTMLInputElement;
  expect([amount.value, period.value, after.value]).toEqual(['', '', '']);
  expect(amount.getAttribute('aria-invalid')).toBe('true');
  expect(after.getAttribute('aria-invalid')).toBe('true');
  expect(button('Save structured edits').disabled).toBe(true);
});

it('accepts digits only in numeric fields and never saves on Enter', async () => {
  const handlers = panel(v2Detail()),
    user = setup();
  await openCiti(user);
  const rate = control('edit-cards-0-rules-0-rateBps') as HTMLInputElement;
  for (const value of ['0x10', '1e3', ' 200', '2.5', '-1']) {
    fireEvent.change(rate, { target: { value } });
    expect(rate.value).toBe(value);
    expect(rate.getAttribute('aria-invalid')).toBe('true');
    expect(text()).toContain('Enter a whole number using digits only.');
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
  const user = setup();
  await openCiti(user);
  fireEvent.change(control('edit-cards-0-rules-0-paidOnPaymentBps'), { target: { value: '900' } });
  await user.click(byText('.editor-card > summary', 'Citi Double Cash'));
  const problems = byText('.ac-alert__title', /problems? to fix/).closest('.ac-alert')!;
  expect(problems.getAttribute('role')).toBeNull();
  expect(problems.textContent).toMatch(/Citi Double Cash · rule [a-z0-9-]+ · paidOnPaymentBps/);
  expect(problems.textContent).not.toMatch(/edit in JSON/);
  await user.click(button('Open Citi Double Cash'));
  await waitFor(() => expect(document.activeElement?.id).toBe('edit-cards-0-rules-0-paidOnPaymentBps'));
});

it('skips capture files too large to be a capture without reading them', async () => {
  panel(v2Detail());
  const user = setup();
  await user.click(summary('Capture all missing sources'));
  const big = new File(['x'.repeat(1_000_001)], 'citi-double-cash-product.txt', { type: 'text/plain' });
  const read = vi.spyOn(big, 'text');
  await user.upload(control('capture-files'), [big]);
  await waitFor(() => expect(text()).toMatch(/Loaded 0 files; skipped 1 too large to be a capture/));
  expect(read).not.toHaveBeenCalled();
});

it('refuses a capture file whose SHA-256 differs from the corpus manifest', async () => {
  const handlers = panel(v2Detail()),
    user = setup();
  await user.click(summary('Capture all missing sources'));
  // citi-double-cash-product is in evals/curation/real/manifest.json with the real page's hash.
  await user.upload(control('capture-files'), [
    new File(['Not the captured Citi page'], 'citi-double-cash-product.txt', { type: 'text/plain' }),
  ]);
  await waitFor(() =>
    expect(text()).toMatch(
      /Loaded 0 files\. Refused 1 whose SHA-256 differs from the corpus manifest \(citi-double-cash-product\.txt\)/,
    ),
  );
  expect((control('capture-citi-double-cash-product') as HTMLTextAreaElement).value).toBe('');
  expect(button(/^Capture 0 of \d+ missing sources and attach$/).disabled).toBe(true);
  expect(handlers.onDirty).not.toHaveBeenLastCalledWith(true);
});
