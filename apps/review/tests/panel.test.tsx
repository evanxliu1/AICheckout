import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftPanel } from '../src/ReviewWorkspace';
import { reviewFixture, now } from './fixtures';

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function panel(detail = reviewFixture()) {
  const handlers = { onDirty: vi.fn(), onUpdate: vi.fn(async () => {}), onCapture: vi.fn(async () => {}), onPublish: vi.fn(async () => {}) };
  render(<DraftPanel detail={detail} busy={false} {...handlers} />); return handlers;
}
it('requires the explicit review acknowledgement and note even for an implicit form submit', async () => {
  const handlers = panel(), user = userEvent.setup();
  const publish = screen.getByRole('button', { name: 'Publish reviewed terms' });
  expect((publish as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(publish.closest('form')!); expect(handlers.onPublish).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox'));
  await user.type(screen.getByLabelText('Review note'), 'Checked all synthetic source terms.');
  await user.click(publish);
  expect(handlers.onPublish).toHaveBeenCalledExactlyOnceWith('Checked all synthetic source terms.');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
});
it('renders hostile source text as text, without executing or rendering embedded HTML', () => {
  panel();
  expect(screen.getAllByText(/Synthetic test evidence/)).toHaveLength(3);
  expect(document.querySelector('img')).toBeNull();
});
it('makes unsaved edits block publication and discarding them restores the exact saved revision', async () => {
  const handlers = panel(), user = userEvent.setup();
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
  const detail = reviewFixture(); detail.sources = []; detail.draft.source_document_ids = [];
  panel(detail);
  expect(screen.getAllByText('Matching evidence needed')).toHaveLength(3);
  expect((screen.getByRole('button', { name: 'Publish reviewed terms' }) as HTMLButtonElement).disabled).toBe(true);
});
