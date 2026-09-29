import { describe, expect, it } from 'vitest';
import { catalogChanges, publicationIssues } from '../src/comparison';
import { reviewDetailSchema, reviewConfigSchema } from '@ai-checkout/catalog-review';
import { reviewFixture, now } from './fixtures';

describe('review comparison and eligibility', () => {
  it('shows condition changes and removals even when the advertised rate is unchanged', () => {
    const before = reviewFixture().draft.catalog,
      after = structuredClone(before);
    after.cards[1].rules[1].requiresActivation = true;
    delete after.cards[1].rules[1].annualCapCents;
    after.cards.splice(0, 1);
    after.sources[1].url = 'https://issuer.example/updated';
    const rows = catalogChanges(before, after);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ before: 'Not required', after: 'Required' }),
        expect.objectContaining({ before: '$6,000.00', after: 'No cap modeled' }),
        expect.objectContaining({ before: '1.5%', after: 'Removed' }),
        expect.objectContaining({ after: 'https://issuer.example/updated' }),
      ]),
    );
    expect(rows.some((row) => row.key.endsWith('bce-online-retail.rate'))).toBe(false);
  });
  it('does not turn array ordering into a rule change', () => {
    const before = reviewFixture().draft.catalog,
      after = structuredClone(before);
    after.cards.reverse();
    after.sources.reverse();
    after.cards[0].rules.reverse();
    after.cards[0].rules[0].sourceIds.reverse();
    expect(catalogChanges(before, after)).toEqual([]);
  });
  it('allows approval only for a current draft with exact captured metadata', () => {
    const detail = reviewFixture();
    expect(publicationIssues(detail, now)).toEqual([]);
    detail.sources[0].url = 'https://issuer.example/wrong';
    expect(publicationIssues(detail, now)).toContain(
      'Capture matching evidence for every source before publication.',
    );
  });
  it('blocks stale bases, expired/future terms, and already published drafts', () => {
    const detail = reviewFixture();
    detail.head = 2;
    expect(publicationIssues(detail, now).join(' ')).toContain('Rebase');
    detail.head = null;
    detail.draft.status = 'published';
    expect(publicationIssues(detail, now).join(' ')).toContain('already been reviewed');
    detail.draft.status = 'draft';
    expect(publicationIssues(detail, Date.parse(detail.draft.catalog.expiresAt)).join(' ')).toContain(
      'expired',
    );
    expect(publicationIssues(detail, Date.parse(detail.draft.catalog.verifiedAt) - 1).join(' ')).toContain(
      'future',
    );
  });
  it('permits an expired published snapshot as review context, and rejects inconsistent heads', () => {
    const detail = reviewFixture();
    detail.head = 1;
    detail.draft.base_sequence = 1;
    detail.draft.catalog.version = 'next.1';
    detail.published = {
      sequence: 1,
      catalog: reviewFixture().draft.catalog,
      version: reviewFixture().draft.catalog.version,
      catalog_hash: 'c'.repeat(64),
      published_at: '2026-09-25T01:00:00Z',
    };
    detail.published.catalog.expiresAt = '2026-09-26T00:00:00Z';
    expect(reviewDetailSchema.safeParse(detail).success).toBe(true);
    expect(publicationIssues(detail, now)).toEqual([]);
    detail.head = 2;
    expect(reviewDetailSchema.safeParse(detail).success).toBe(false);
  });
  it.each(['sb_secret_not_for_browsers', 'legacy-service-role', ''])(
    'never accepts an administrative config key (%s)',
    (key) => {
      expect(
        reviewConfigSchema.safeParse({ supabaseUrl: 'https://project.supabase.co', publishableKey: key })
          .success,
      ).toBe(false);
    },
  );
});
