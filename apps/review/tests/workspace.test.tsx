import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewSummary } from '@ai-checkout/catalog-review';
import ReviewWorkspace from '../src/ReviewWorkspace';
import type { ReviewApi } from '../src/client';
import { reviewFixture, now } from './fixtures';

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  history.replaceState(null, '', '/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const docId = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function workspace(detail: ReviewSummary) {
  let nextDoc = 1;
  const api = {
    queue: vi.fn(async () => ({
      reviewerId: detail.reviewerId,
      head: detail.head,
      drafts: [
        {
          id: detail.draft.id,
          revision: detail.draft.revision,
          status: detail.draft.status,
          updated_at: detail.draft.updated_at,
          base_sequence: detail.draft.base_sequence,
          version: detail.draft.catalog.version,
        },
      ],
    })),
    detail: vi.fn(async () => structuredClone(detail)),
    capture: vi.fn(async (body: { sourceKey: string }) => ({
      id: docId(nextDoc++),
      source_key: body.sourceKey,
    })),
    update: vi.fn(async () => detail.draft),
    publish: vi.fn(async () => ({ version: detail.draft.catalog.version, sequence: 1 })),
  };
  render(<ReviewWorkspace api={api as unknown as ReviewApi} />);
  return api;
}
/** One captured source of three; the other two are missing. */
function partlyCaptured() {
  const detail = reviewFixture();
  detail.sources = detail.sources.slice(0, 1);
  detail.draft.source_document_ids = [detail.sources[0].id];
  return detail;
}
async function fillMissing(detail: ReviewSummary) {
  const user = userEvent.setup();
  await screen.findByRole('heading', { level: 1, name: detail.draft.catalog.version });
  await user.click(screen.getByText('Capture all missing sources'));
  for (const source of detail.draft.catalog.sources.slice(1))
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(`\\(${source.id}\\)`) }), {
      target: { value: `Terms for ${source.id}` },
    });
  await user.click(screen.getByRole('button', { name: 'Capture 2 of 2 missing sources and attach' }));
}

it('captures every filled source, then attaches all of them in one revision of the saved draft', async () => {
  const detail = partlyCaptured();
  const api = workspace(detail);
  await fillMissing(detail);
  await screen.findByText('Captured 2 sources and attached them to a new draft revision.');
  expect(api.capture.mock.calls.map(([body]) => body)).toEqual(
    detail.draft.catalog.sources.slice(1).map((source) => ({
      sourceKey: source.id,
      title: source.title,
      url: source.url,
      checkedOn: source.checkedOn,
      body: `Terms for ${source.id}`,
    })),
  );
  expect(api.update).toHaveBeenCalledExactlyOnceWith(
    detail.draft.id,
    {
      catalog: detail.draft.catalog,
      baseSequence: detail.draft.base_sequence,
      sourceDocumentIds: [detail.sources[0].id, docId(1), docId(2)],
      expectedRevision: detail.draft.revision,
    },
    expect.any(AbortSignal),
  );
});

it('attaches nothing when a capture fails part way, and keeps the loaded texts', async () => {
  const detail = partlyCaptured();
  const api = workspace(detail);
  api.capture
    .mockImplementationOnce(async (body: { sourceKey: string }) => ({
      id: docId(1),
      source_key: body.sourceKey,
    }))
    .mockRejectedValueOnce(new Error('The source could not be captured.'));
  await fillMissing(detail);
  expect(await screen.findByText('The source could not be captured.')).toBeTruthy();
  expect(api.capture).toHaveBeenCalledTimes(2);
  expect(api.update).not.toHaveBeenCalled();
  const second = detail.draft.catalog.sources[2];
  expect(
    (screen.getByRole('textbox', { name: new RegExp(`\\(${second.id}\\)`) }) as HTMLTextAreaElement).value,
  ).toBe(`Terms for ${second.id}`);
});

it('moves focus to the refreshed draft heading after publishing', async () => {
  const detail = reviewFixture();
  const api = workspace(detail);
  const user = userEvent.setup();
  await screen.findByRole('heading', { level: 1, name: detail.draft.catalog.version });
  await user.click(screen.getByRole('checkbox', { name: /I checked the full source terms/ }));
  await user.type(screen.getByLabelText('Review note'), 'Checked all synthetic source terms.');
  await user.click(screen.getByRole('button', { name: 'Publish reviewed terms' }));
  const published = structuredClone(detail);
  published.draft.status = 'published';
  api.detail.mockResolvedValue(published);
  await user.click(await screen.findByRole('button', { name: 'Publish release' }));
  await screen.findByText(/Published .* as release 1\./);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: detail.draft.catalog.version }),
    ),
  );
});
