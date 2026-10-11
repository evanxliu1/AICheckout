import { describe, expect, it } from 'vitest';
import {
  CATALOG_V3,
  MERCHANTS_V1,
  MERCHANT_RELEASE_LIMITS,
  merchantReleaseSchema,
  recordToProfile,
} from '../src/domain';
import type { MerchantRecord } from '../src/domain';
import { MERCHANT_RELEASE_FIXTURE, merchantReleaseCases } from '../../packages/rewards-core/test-cases';

/* Merchant release schema 1 (Phase 14.1). The contract cases live in test-cases.ts so 14.6 can run the
 * same list through the SQL validator. */

describe('merchant release schema', () => {
  it.each(merchantReleaseCases)('$name has the intended validity', ({ input, valid }) => {
    expect(merchantReleaseSchema.safeParse(input).success).toBe(valid);
  });
  it('covers every evidence basis and kind in the fixture', () => {
    expect(new Set(MERCHANT_RELEASE_FIXTURE.merchants.map((m) => m.evidence.basis))).toEqual(
      new Set(['issuer', 'corroborated', 'default']),
    );
    expect(MERCHANT_RELEASE_FIXTURE.merchants.some((m) => m.kind === 'processor')).toBe(true);
    expect(MERCHANT_RELEASE_FIXTURE.merchants.some((m) => m.disabled)).toBe(true);
  });
  it('limits the release to 2 MiB and 5,000 records', () => {
    expect(MERCHANT_RELEASE_LIMITS.bytes).toBe(2_097_152);
    expect(MERCHANT_RELEASE_LIMITS.merchants).toBe(5000);
  });
});

describe('bundled merchant release', () => {
  it('is valid and small', () => {
    expect(merchantReleaseSchema.parse(MERCHANTS_V1)).toEqual(MERCHANTS_V1);
    expect(new TextEncoder().encode(JSON.stringify(MERCHANTS_V1)).byteLength).toBeLessThan(16_384);
  });
  it('keeps the three legacy ids with their catalog brands', () => {
    for (const legacy of CATALOG_V3.merchants) {
      const record = MERCHANTS_V1.merchants.find((m) => m.id === legacy.id)!;
      expect(record.kind).toBe('merchant');
      expect(record.brandIds).toEqual(legacy.brandIds);
      expect(record.brandIds.every((id) => CATALOG_V3.brands.some((b) => b.id === id))).toBe(true);
    }
  });
  it('gives no category without evidence, and cites a source for every category it gives', () => {
    // Since the 14.3 dry run the bundled release carries records with evidence (cvs-us, drugstores, issuer).
    const ids = new Set(MERCHANTS_V1.sources.map((s) => s.id));
    for (const m of MERCHANTS_V1.merchants) {
      if (m.evidence.basis === 'default') expect(m.category, m.id).toBe('general-merchandise');
      else {
        expect(m.evidence.sourceIds.length, m.id).toBeGreaterThan(0);
        for (const id of m.evidence.sourceIds) expect(ids.has(id), `${m.id} cites ${id}`).toBe(true);
      }
    }
  });
  it('lists payment processors without goods', () => {
    const processors = MERCHANTS_V1.merchants.filter((m) => m.kind === 'processor');
    expect(processors.length).toBe(15);
    expect(processors.every((m) => !m.physicalGoods && m.brandIds.length === 0)).toBe(true);
    expect(processors.map((m) => m.id)).toContain('paypal');
    expect(processors.find((m) => m.id === 'shop-pay')!.hosts).toEqual(['shop.app', 'pay.shopify.com']);
  });
});

describe('recordToProfile', () => {
  const record = (extra: Partial<MerchantRecord> = {}): MerchantRecord => ({
    id: 'kroger-us',
    name: 'Kroger',
    hosts: ['kroger.com'],
    kind: 'merchant',
    physicalGoods: true,
    category: 'supermarkets',
    evidence: { basis: 'corroborated', sourceIds: ['a', 'b'] },
    brandIds: [],
    disabled: false,
    ...extra,
  });
  it('is an online U.S. store with the record category, goods flag and brands', () => {
    expect(recordToProfile(record({ brandIds: ['amazon'] }), CATALOG_V3)).toEqual({
      id: 'kroger-us',
      name: 'Kroger',
      onlineRetail: true,
      physicalGoods: true,
      usMerchant: true,
      expectedCategory: 'supermarkets',
      mcc: { code: null, confidence: 'low', sourceIds: [] },
      notes: '',
      brandIds: ['amazon'],
    });
    expect(recordToProfile(record({ physicalGoods: false }), CATALOG_V3).physicalGoods).toBe(false);
  });
  it('ignores brands the catalog in effect does not know (release skew)', () => {
    const profile = recordToProfile(record({ brandIds: ['amazon', 'future-brand', 'walmart'] }), CATALOG_V3);
    expect(profile.brandIds).toEqual(['amazon', 'walmart']);
    expect(recordToProfile(record({ brandIds: ['future-brand'] }), { brands: [] }).brandIds).toEqual([]);
  });
  it('treats a category the engine does not know as general merchandise (release skew)', () => {
    const skewed = record({ category: 'pet-supplies' as MerchantRecord['category'] });
    expect(recordToProfile(skewed, CATALOG_V3).expectedCategory).toBe('general-merchandise');
    expect(
      merchantReleaseSchema.safeParse({ ...MERCHANT_RELEASE_FIXTURE, merchants: [skewed] }).success,
    ).toBe(false);
  });
  it('does not read the processor or disabled flags (the caller decides those)', () => {
    const profile = recordToProfile(
      record({ kind: 'processor', disabled: true, physicalGoods: false }),
      CATALOG_V3,
    );
    expect(profile.id).toBe('kroger-us');
    expect(profile.physicalGoods).toBe(false);
  });
});
