import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExtractionReview } from '@ai-checkout/catalog-review/curation';
import { ExtractionResult } from '../src/ExtractionPanel';
import { reviewFixture } from './fixtures';
import { createReviewApi, ReviewApiError } from '../src/client';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fixture() {
  const detail = reviewFixture(),
    doc = detail.sources[0],
    quote = 'Synthetic test evidence.';
  const evidence = [
    { documentId: doc.id, contentHash: doc.content_hash, quote, start: 0, end: quote.length },
  ];
  const runId = '40000000-0000-4000-8000-000000000001',
    now = '2026-09-26T00:00:00Z';
  const review: ExtractionReview = {
    blockers: [],
    application: null,
    documents: [doc],
    proposedCatalog: structuredClone(detail.draft.catalog),
    run: {
      id: runId,
      requested_by: detail.reviewerId,
      session_id: runId,
      request_key: runId,
      request_hash: 'a'.repeat(64),
      profile_id: 'fixture',
      profile: {
        id: 'fixture',
        enabled: true,
        provider: 'fixture',
        model: 'synthetic-v1',
        mode: 'fixture',
        input_price: 0,
        output_price: 0,
        max_input_tokens: 48000,
        max_output_tokens: 4096,
        max_attempts: 2,
        attempt_timeout_ms: 10000,
        total_timeout_ms: 15000,
      },
      card_id: 'capital-one-quicksilver',
      context: {},
      context_hash: 'b'.repeat(64),
      budget_day: '2026-09-26',
      reserved_microusd: 0,
      state: 'finished',
      started_at: now,
      deadline_at: now,
      finished_at: now,
      trace_hash: 'c'.repeat(64),
      interruption_note: null,
      trace: {
        runId,
        startedAt: now,
        durationMs: 10,
        status: 'evidence_valid',
        provider: { id: 'fixture', model: 'synthetic-v1', mode: 'fixture', pricing: { input: 0, output: 0 } },
        limits: {
          budgetMicrousd: 0,
          maxInputTokens: 48000,
          maxOutputTokens: 4096,
          maxAttempts: 2,
          attemptTimeoutMs: 10000,
          totalTimeoutMs: 15000,
        },
        documents: [{ id: doc.id, contentHash: doc.content_hash }],
        attempts: [],
        accountedMicrousd: 0,
        findings: [],
        extraction: {
          schemaVersion: 1,
          cardId: 'capital-one-quicksilver',
          rules: [
            {
              ruleId: 'quicksilver-base',
              rateBps: { state: 'known', value: 250, evidence },
              category: { state: 'known', value: 'all-eligible', evidence },
              activation: { state: 'known', value: false, evidence },
              cap: { state: 'known', kind: 'none', amountCents: null, period: null, evidence },
            },
          ],
          conditions: [
            { kind: 'eligibility', text: 'Synthetic condition. <img src=x onerror=alert(1)>', evidence },
          ],
          issues: [],
        },
      },
    },
  };
  review.proposedCatalog!.cards[0].rules[0].rateBps = 250;
  return { detail, review };
}
it('requires every condition decision, its rule and explanation, an overall note and fresh acknowledgement', async () => {
  const f = fixture(),
    onApply = vi.fn(async () => {}),
    user = userEvent.setup();
  render(<ExtractionResult {...f} disabled={false} onApply={onApply} />);
  const apply = screen.getByRole('button', { name: 'Apply reviewed extraction to draft' });
  expect(screen.getByText('Condition 1: choose how it is covered.')).toBeTruthy();
  expect(screen.getByText('Add an extraction review note of at least 10 characters.')).toBeTruthy();
  fireEvent.submit(apply.closest('form')!);
  expect(onApply).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText('How is condition 1 covered?'), 'unrepresentable');
  expect((apply as HTMLButtonElement).disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText('How is condition 1 covered?'), 'existing-rules');
  expect(screen.getByText('Condition 1: select at least one covering rule.')).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: 'quicksilver-base' }));
  await user.type(
    screen.getByLabelText('Why these rules cover condition 1'),
    'This rule covers the explicit eligibility condition.',
  );
  await user.type(
    screen.getByLabelText('Extraction review note'),
    'Checked all synthetic facts and conditions.',
  );
  const confirm = screen.getByRole('checkbox', { name: /I checked every extracted fact/ });
  await user.click(confirm);
  expect((apply as HTMLButtonElement).disabled).toBe(false);
  await user.type(screen.getByLabelText('Extraction review note'), ' Again.');
  expect((confirm as HTMLInputElement).checked).toBe(false);
  await user.click(confirm);
  await user.click(apply);
  expect(onApply).toHaveBeenCalledOnce();
  expect(onApply.mock.calls[0]).toEqual([
    expect.objectContaining({
      expectedRevision: 1,
      expectedHash: f.detail.draft.catalog_hash,
      conditionReviews: [
        {
          index: 0,
          coverage: 'existing-rules',
          ruleIds: ['quicksilver-base'],
          note: 'This rule covers the explicit eligibility condition.',
        },
      ],
    }),
  ]);
  expect((confirm as HTMLInputElement).checked).toBe(false);
  expect(document.querySelector('img')).toBeNull();
});
it('shows unresolved facts and keeps the application control absent', () => {
  const f = fixture();
  f.review.blockers = ['Unresolved facts require correction.'];
  f.review.proposedCatalog = null;
  f.review.run.trace!.status = 'needs_review';
  f.review.run.trace!.extraction!.rules[0].activation = { state: 'unknown', value: null, evidence: [] };
  render(<ExtractionResult {...f} disabled={false} onApply={vi.fn()} />);
  expect(screen.getByText('Unknown')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Apply reviewed/ })).toBeNull();
  expect(screen.getByText('Unresolved facts require correction.')).toBeTruthy();
});
it('renders stored application conditions as an audit record without another apply action', () => {
  const f = fixture();
  f.review.proposedCatalog = null;
  f.review.application = {
    run_id: f.review.run.id,
    draft_id: f.detail.draft.id,
    from_revision: 1,
    to_revision: 2,
    result_hash: 'c'.repeat(64),
    applied_by: f.detail.reviewerId,
    applied_at: '2026-09-26T00:00:00Z',
    review_note: 'Human reviewed this synthetic case.',
    condition_reviews: [
      {
        index: 0,
        coverage: 'existing-rules',
        ruleIds: ['quicksilver-base'],
        note: 'Full condition remained covered by the rule.',
      },
    ],
  };
  render(<ExtractionResult {...f} disabled={false} onApply={vi.fn()} />);
  expect(screen.getByText(/Condition 1 → quicksilver-base/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Apply reviewed/ })).toBeNull();
});
it('preserves a validated recovery run ID but not private error details', async () => {
  const runId = fixture().review.run.id;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: 'curation_result_unconfirmed', runId, secret: 'PRIVATE SQL' },
          { status: 503 },
        ),
      ),
  );
  const api = createReviewApi(async () => 'token', vi.fn());
  try {
    await api.extract(fixture().detail.draft.id, {}, new AbortController().signal);
    throw new Error('Expected failure');
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewApiError);
    expect((error as ReviewApiError).runId).toBe(runId);
    expect((error as Error).message).not.toContain('PRIVATE');
  }
});
