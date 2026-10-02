import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOG_V2 } from '@ai-checkout/rewards-core';
import type { ReviewDetail } from '@ai-checkout/catalog-review';
import ReviewWorkspace from '../src/ReviewWorkspace';
import type { ReviewApi } from '../src/client';
import { reviewFixture } from './fixtures';

/** A day after the bundled catalog was verified, while it is valid. */
const valid = Date.parse(CATALOG_V2.verifiedAt) + 86_400_000;
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(valid);
  history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const setup = () => userEvent.setup({ delay: null });
const button = (name: string) => {
  const found = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === name);
  if (found.length !== 1) throw new Error(`Expected one button "${name}", found ${found.length}`);
  return found[0];
};

/** A backend whose queue starts empty (or with `existing`) and that records created drafts. */
function backend({ head = null, existing }: { head?: number | null; existing?: ReviewDetail } = {}) {
  let created: ReviewDetail | undefined;
  const queueOf = (detail?: ReviewDetail) =>
    detail
      ? [
          {
            id: detail.draft.id,
            revision: detail.draft.revision,
            status: detail.draft.status,
            updated_at: detail.draft.updated_at,
            base_sequence: detail.draft.base_sequence,
            version: detail.draft.catalog.version,
          },
        ]
      : [];
  const api = {
    queue: vi.fn(async () => ({
      reviewerId: '10000000-0000-4000-8000-000000000001',
      head,
      drafts: queueOf(created ?? existing),
    })),
    detail: vi.fn(async () => structuredClone((created ?? existing)!)),
    create: vi.fn(async (body: { catalog: ReviewDetail['draft']['catalog'] }) => {
      created = reviewFixture();
      created.head = head;
      created.draft.id = '30000000-0000-4000-8000-000000000009';
      created.draft.catalog = body.catalog;
      created.draft.base_sequence = head;
      created.sources = [];
      created.draft.source_document_ids = [];
      return created.draft;
    }),
  };
  render(<ReviewWorkspace api={api as unknown as ReviewApi} />);
  return api;
}

it('offers to start a draft from the bundled catalog when the queue is empty, and opens it', async () => {
  const api = backend({ head: 3 });
  const user = setup();
  expect(await screen.findByText('No drafts are waiting for review.')).toBeTruthy();
  expect(screen.getByText(CATALOG_V2.version)).toBeTruthy();
  expect(screen.getByText('Valid now')).toBeTruthy();
  await user.click(button('Create draft'));
  const dialog = await screen.findByRole('dialog', { name: `Create a draft of ${CATALOG_V2.version}?` });
  expect(document.activeElement).toBe(button('Cancel'));
  expect(api.create).not.toHaveBeenCalled();
  await user.click(button('Create the draft'));
  expect(dialog.isConnected).toBe(false);
  await screen.findByText(/Draft .* created\. Attach its source evidence/);
  expect(api.create).toHaveBeenCalledExactlyOnceWith(
    { catalog: CATALOG_V2, sourceDocumentIds: [], baseSequence: 3 },
    expect.any(AbortSignal),
  );
  const heading = screen.getByRole('heading', { level: 1, name: CATALOG_V2.version });
  await waitFor(() => expect(document.activeElement).toBe(heading));
});

it('refuses the bundled catalog before it is valid and after it expires', async () => {
  for (const at of [Date.parse(CATALOG_V2.verifiedAt) - 60_000, Date.parse(CATALOG_V2.expiresAt)]) {
    vi.spyOn(Date, 'now').mockReturnValue(at);
    const api = backend();
    const user = setup();
    await screen.findByText('Cannot be used');
    await user.click(button('Create draft'));
    expect(await screen.findByText(/The bundled catalog cannot start a draft\./)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.create).not.toHaveBeenCalled();
    cleanup();
  }
});

it('validates pasted catalog JSON with the catalog schema before creating a draft', async () => {
  const api = backend();
  const user = setup();
  await screen.findByText('No drafts are waiting for review.');
  await user.click(screen.getByLabelText('Catalog JSON I paste'));
  const json = screen.getByLabelText('Catalog JSON');
  fireEvent.change(json, { target: { value: '{ not json' } });
  await user.click(button('Create draft'));
  expect(await screen.findByText(/must be valid JSON/)).toBeTruthy();
  const broken = structuredClone(CATALOG_V2);
  broken.cards[0].rules[0].paidOnPaymentBps = 900;
  fireEvent.change(json, { target: { value: JSON.stringify(broken) } });
  await user.click(button('Create draft'));
  expect(await screen.findByText(/paid-on-payment portion cannot exceed the rate/)).toBeTruthy();
  const future = structuredClone(CATALOG_V2);
  future.verifiedAt = '2026-10-05T00:00:00Z';
  future.expiresAt = '2026-10-30T00:00:00Z';
  fireEvent.change(json, { target: { value: JSON.stringify(future) } });
  await user.click(button('Create draft'));
  expect(await screen.findByText(/This catalog cannot start a draft\./)).toBeTruthy();
  expect(api.create).not.toHaveBeenCalled();

  const edited = structuredClone(CATALOG_V2);
  edited.version = '2026-09-30.real.2';
  fireEvent.change(json, { target: { value: JSON.stringify(edited) } });
  await user.click(button('Create draft'));
  await user.click(await screen.findByRole('button', { name: 'Create the draft' }));
  await waitFor(() =>
    expect(api.create).toHaveBeenCalledWith(
      { catalog: edited, sourceDocumentIds: [], baseSequence: null },
      expect.any(AbortSignal),
    ),
  );
});

it('can start a new draft while other drafts are queued, and cancel back to the open draft', async () => {
  const existing = reviewFixture();
  existing.draft.catalog = structuredClone(CATALOG_V2);
  existing.draft.catalog.version = '2026-09-29.real.0';
  backend({ existing });
  const user = setup();
  await screen.findByRole('heading', { level: 1, name: '2026-09-29.real.0' });
  await user.click(button('Start a new draft'));
  const heading = await screen.findByRole('heading', { level: 1, name: 'Start a new draft' });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  await user.click(button('Cancel'));
  const draftHeading = await screen.findByRole('heading', { level: 1, name: '2026-09-29.real.0' });
  await waitFor(() => expect(document.activeElement).toBe(draftHeading));
});

it('leaves the start form when a queued draft is opened', async () => {
  const existing = reviewFixture();
  existing.draft.catalog = structuredClone(CATALOG_V2);
  existing.draft.catalog.version = '2026-09-29.real.0';
  backend({ existing });
  const user = setup();
  await screen.findByRole('heading', { level: 1, name: '2026-09-29.real.0' });
  await user.click(button('Start a new draft'));
  await screen.findByRole('heading', { level: 1, name: 'Start a new draft' });
  await user.click(screen.getByText('2026-09-29.real.0', { selector: '.queue-item strong' }));
  expect(await screen.findByRole('heading', { level: 1, name: '2026-09-29.real.0' })).toBeTruthy();
  expect(screen.queryByRole('heading', { level: 1, name: 'Start a new draft' })).toBeNull();
});

it('keeps the form, its pasted JSON and focus when creating fails', async () => {
  const api = backend();
  api.create.mockRejectedValueOnce(new Error('The draft could not be saved.'));
  const user = setup();
  await screen.findByText('No drafts are waiting for review.');
  await user.click(screen.getByLabelText('Catalog JSON I paste'));
  const json = screen.getByLabelText('Catalog JSON') as HTMLTextAreaElement;
  fireEvent.change(json, { target: { value: JSON.stringify(CATALOG_V2) } });
  await user.click(button('Create draft'));
  await user.click(await screen.findByRole('button', { name: 'Create the draft' }));
  expect(await screen.findByText('The draft could not be saved.')).toBeTruthy();
  expect(screen.getByLabelText('Catalog JSON')).toBe(json);
  expect(json.value).toBe(JSON.stringify(CATALOG_V2));
});

it('does not offer to create a second draft when loading the new one fails', async () => {
  const api = backend();
  api.detail.mockRejectedValueOnce(new Error('The draft could not be loaded.'));
  const user = setup();
  await screen.findByText('No drafts are waiting for review.');
  await user.click(button('Create draft'));
  await user.click(await screen.findByRole('button', { name: 'Create the draft' }));
  expect(await screen.findByText('The draft could not be loaded.')).toBeTruthy();
  expect(location.hash).toBe('#30000000-0000-4000-8000-000000000009');
  expect(screen.queryByRole('heading', { level: 1, name: 'Start a new draft' })).toBeNull();
  expect(screen.getByText(CATALOG_V2.version, { selector: '.queue-item strong' })).toBeTruthy();
  await user.click(button('Reload latest draft'));
  expect(await screen.findByRole('heading', { level: 1, name: CATALOG_V2.version })).toBeTruthy();
  expect(api.create).toHaveBeenCalledTimes(1);
});

it('requires explicit confirmation to create a second draft of a queued version', async () => {
  const existing = reviewFixture();
  existing.draft.catalog = structuredClone(CATALOG_V2);
  const api = backend({ existing });
  const user = setup();
  await screen.findByRole('heading', { level: 1, name: CATALOG_V2.version });
  await user.click(button('Start a new draft'));
  await user.click(button('Create draft'));
  await screen.findByText('A draft of this version is already waiting');
  const confirm = button('Create the draft');
  expect(confirm.disabled).toBe(true);
  await user.click(screen.getByLabelText(`Create another ${CATALOG_V2.version} draft anyway`));
  expect(confirm.disabled).toBe(false);
  await user.click(confirm);
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
});

it('checks validity when Create draft is chosen, not when the form was drawn', async () => {
  const api = backend();
  const user = setup();
  await screen.findByText('Valid now');
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(CATALOG_V2.expiresAt) + 1);
  await user.click(button('Create draft'));
  expect(await screen.findByText(/The bundled catalog cannot start a draft\./)).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.create).not.toHaveBeenCalled();
});
