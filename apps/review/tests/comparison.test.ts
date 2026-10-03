import { describe, expect, it } from 'vitest';
import { CATALOG_V2, type CatalogV1 } from '@ai-checkout/rewards-core';
import { catalogChanges, publicationIssues, ruleSummaries } from '../src/comparison';
import { reviewSummarySchema, reviewConfigSchema } from '@ai-checkout/catalog-review';
import { CATALOG_V3_FIXTURE } from '../../../packages/rewards-core/test-cases.ts';
import { reviewFixture, now } from './fixtures';

describe('review comparison and eligibility', () => {
  it('shows condition changes and removals even when the advertised rate is unchanged', () => {
    const before = reviewFixture().draft.catalog as CatalogV1,
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
  it('diffs catalog v2 rules generically and against a v1 base', () => {
    const after = structuredClone(CATALOG_V2);
    const bce = after.cards.find((card) => card.id === 'amex-blue-cash-everyday')!;
    const online = bce.rules.find((rule) => rule.id === 'bce-online-retail')!;
    online.cap = { kind: 'spend', amountCents: 300_000, period: 'calendar-year', rateAfterCapBps: 100 };
    online.activation = 'enroll-once';
    online.limitedTime = { endsOn: '2026-12-31' };
    after.cards.find((card) => card.id === 'citi-double-cash')!.rules[0].paidOnPaymentBps = 50;
    const rows = catalogChanges(CATALOG_V2, after);
    expect(rows.map((row) => [row.label, row.before, row.after])).toEqual(
      expect.arrayContaining([
        [
          'Blue Cash Everyday · bce-online-retail · Spend cap',
          '$6,000.00 per year-unspecified, then 1%',
          '$3,000.00 per calendar-year, then 1%',
        ],
        ['Blue Cash Everyday · bce-online-retail · Activation', 'unstated', 'enroll-once'],
        ['Blue Cash Everyday · bce-online-retail · Limited time', 'No', 'Ends 2026-12-31'],
        ['Double Cash · double-cash-base · Paid when the balance is paid', '1%', '0.5%'],
      ]),
    );
    expect(rows).toHaveLength(4);
    const fromV1 = catalogChanges(reviewFixture().draft.catalog, CATALOG_V2);
    expect(fromV1).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Catalog schema', before: '1', after: '2' })]),
    );
    expect(ruleSummaries(bce.rules).find((row) => row.rule.id === 'bce-online-retail')?.conditions).toContain(
      'Excludes bnpl.',
    );
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
    expect(reviewSummarySchema.safeParse(detail).success).toBe(true);
    expect(publicationIssues(detail, now)).toEqual([]);
    detail.head = 2;
    expect(reviewSummarySchema.safeParse(detail).success).toBe(false);
  });
  it('diffs every catalog v3 field and groups rows by card and section', () => {
    const after = structuredClone(CATALOG_V3_FIXTURE);
    const points = after.programs.find((program) => program.id === 'test-membership-points')!;
    if (points.valuation.basis === 'published-estimate') points.valuation.valueHundredthsOfCent = 150;
    after.brands[0].name = 'Amazon.com';
    after.gates[0].options[1].label = 'Not a Prime member';
    const prime = after.cards.find((card) => card.id === 'test-prime-visa')!;
    prime.acceptance = { kind: 'closed-loop', brandIds: ['amazon'] };
    const amazon = prime.rules.find((rule) => rule.id === 'prime-amazon')!;
    amazon.brandIds = ['amazon'];
    amazon.excludedBrandIds = ['walmart'];
    amazon.requiredPaymentPaths = ['venmo'];
    amazon.requires = [{ gateId: 'amazon-prime', optionIds: ['not-member'] }];
    const cashPlus = after.cards.find((card) => card.id === 'test-cash-plus')!;
    const electronics = cashPlus.rules.find((rule) => rule.id === 'cash-plus-electronics')!;
    electronics.choice = { choiceId: 'five-percent', optionId: 'fast-food' };
    electronics.sharedCapId = null;
    electronics.limitedTime = { startsOn: '2027-01-01', endsOn: null };
    cashPlus.choices[0].defaultOptionIds = ['electronics'];
    const rows = catalogChanges(CATALOG_V3_FIXTURE, after);
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, [row.before, row.after, row.group]]));
    expect(byLabel['test-membership-points (program) · Value per unit']).toEqual([
      'Published estimate 1.2¢ each, by Example Valuations, read 2026-10-01 (https://valuations.example/points)',
      'Published estimate 1.5¢ each, by Example Valuations, read 2026-10-01 (https://valuations.example/points)',
      'programs',
    ]);
    expect(byLabel['amazon (brand) · Name']).toEqual(['Amazon', 'Amazon.com', 'brands']);
    expect(byLabel['amazon-prime (question) · Answers'][1]).toBe(
      'member: Prime member | not-member: Not a Prime member',
    );
    expect(byLabel['test-prime-visa · Accepted at']).toEqual([
      'Any merchant (open loop)',
      'Only brands amazon (closed loop)',
      'cards.test-prime-visa',
    ]);
    expect(byLabel['Prime Visa · prime-amazon · Only at brands']).toEqual([
      'amazon, whole-foods',
      'amazon',
      'cards.test-prime-visa',
    ]);
    expect(byLabel['Prime Visa · prime-amazon · Never at brands'].slice(0, 2)).toEqual(['None', 'walmart']);
    expect(byLabel['Prime Visa · prime-amazon · Only when paying with'].slice(0, 2)).toEqual([
      'Any payment path',
      'venmo',
    ]);
    expect(byLabel['Prime Visa · prime-amazon · Requires'].slice(0, 2)).toEqual([
      'amazon-prime is member',
      'amazon-prime is not-member',
    ]);
    expect(byLabel['Cash Plus · cash-plus-electronics · Chosen category'].slice(0, 2)).toEqual([
      'While five-percent is electronics',
      'While five-percent is fast-food',
    ]);
    expect(byLabel['Cash Plus · cash-plus-electronics · Shared spend cap'].slice(0, 2)).toEqual([
      'cash-plus-five-percent',
      'Not shared',
    ]);
    expect(byLabel['Cash Plus · cash-plus-electronics · Limited time'].slice(0, 2)).toEqual([
      'No',
      'Starts 2027-01-01; ends on an unstated date',
    ]);
    expect(byLabel['test-cash-plus · Choice five-percent'][1]).toMatch(
      /cardholder picks 2 of .*; default electronics$/,
    );
    expect(rows.find((row) => row.group === 'cards.test-cash-plus')?.groupLabel).toBe('Test Cash Plus');
    expect(catalogChanges(CATALOG_V3_FIXTURE, structuredClone(CATALOG_V3_FIXTURE))).toEqual([]);
    const summary = ruleSummaries(prime.rules).find((row) => row.rule.id === 'prime-amazon')!.conditions;
    expect(summary).toContain('Only at amazon.');
    expect(summary).toContain('Never at walmart.');
    expect(summary).toContain('Requires amazon-prime is not-member.');
    expect(summary).toContain('Only when paying with venmo.');
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
