import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from './money.ts';
import {
  CAP_PERIODS,
  MERCHANT_CATEGORIES,
  PAYMENT_PATHS,
  REWARD_CATEGORIES,
  type Catalog,
  type CatalogV1,
  type CatalogV2,
} from './types.ts';

export const MAX_CATALOG_BYTES = 262_144;
export const CATALOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const catalogIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const unique = (values: string[]) => new Set(values).size === values.length;
export const sourceSchema = z.strictObject({
  id: catalogIdSchema,
  title: z.string().min(1).max(200),
  url: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .regex(/^https:\/\/[^\s]+$/)
    .refine((value) => {
      try {
        const url = new URL(value);
        return !url.username && !url.password;
      } catch {
        return false;
      }
    }, 'Source URLs cannot contain credentials.'),
  checkedOn: z.iso.date(),
});
export const rewardRuleSchema = z.strictObject({
  id: catalogIdSchema,
  category: z.enum(['all-eligible', 'us-online-retail']),
  rateBps: z.number().int().min(0).max(10_000),
  annualCapCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS).optional(),
  requiresActivation: z.boolean(),
  sourceIds: z.array(catalogIdSchema).min(1).max(10).refine(unique),
});
export const cardProductSchema = z.strictObject({
  id: catalogIdSchema,
  name: z.string().min(1).max(120),
  shortName: z.string().min(1).max(60),
  rules: z.array(rewardRuleSchema).min(1).max(2),
});
const versionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
type Reject = (message: string, path?: (string | number)[]) => void;

/** Checks shared by both schema versions: validity window, source dates, unique IDs, size. */
function commonInvariants(
  catalog: { verifiedAt: string; expiresAt: string; sources: { id: string; checkedOn: string }[] },
  reject: Reject,
) {
  const verified = Date.parse(catalog.verifiedAt),
    expires = Date.parse(catalog.expiresAt);
  if (expires <= verified || expires - verified > CATALOG_MAX_AGE_MS)
    reject('Catalog validity must be between zero and 30 days.', ['expiresAt']);
  const checkedDate = Date.parse(`${catalog.verifiedAt.slice(0, 10)}T00:00:00Z`);
  catalog.sources.forEach((source, i) => {
    const checked = Date.parse(`${source.checkedOn}T00:00:00Z`);
    if (checked > checkedDate || checkedDate - checked > CATALOG_MAX_AGE_MS)
      reject('Source date must be within 30 days before verification.', ['sources', i, 'checkedOn']);
  });
  if (!unique(catalog.sources.map((s) => s.id))) reject('Source IDs must be unique.', ['sources']);
  if (new TextEncoder().encode(JSON.stringify(catalog)).byteLength > MAX_CATALOG_BYTES)
    reject('Catalog is too large.');
}

export const catalogV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: versionSchema,
    verifiedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    merchantIds: z.array(catalogIdSchema).min(1).max(10).refine(unique),
    sources: z.array(sourceSchema).min(1).max(30),
    cards: z.array(cardProductSchema).min(1).max(30),
  })
  .superRefine((catalog, ctx) => {
    const reject: Reject = (message, path = []) => ctx.addIssue({ code: 'custom', message, path });
    commonInvariants(catalog, reject);
    if (!unique(catalog.cards.map((c) => c.id))) reject('Card IDs must be unique.', ['cards']);
    if (!unique(catalog.cards.flatMap((c) => c.rules.map((r) => r.id))))
      reject('Rule IDs must be globally unique.', ['cards']);
    catalog.cards.forEach((card, index) => {
      const bases = card.rules.filter((r) => r.category === 'all-eligible');
      const bonuses = card.rules.filter((r) => r.category === 'us-online-retail');
      if (
        bases.length !== 1 ||
        bonuses.length > 1 ||
        bases[0]?.annualCapCents !== undefined ||
        bases[0]?.requiresActivation
      ) {
        reject('A card needs one uncapped, unconditional base and at most one online-retail bonus.', [
          'cards',
          index,
          'rules',
        ]);
      }
      card.rules.forEach((rule, i) => {
        if (bases[0] && rule.rateBps < bases[0].rateBps)
          reject('Bonus rate cannot be below the base.', ['cards', index, 'rules', i]);
        if (rule.sourceIds.some((id) => !catalog.sources.some((s) => s.id === id)))
          reject('Rule references an absent source.', ['cards', index, 'rules', i, 'sourceIds']);
      });
    });
  }) satisfies z.ZodType<CatalogV1>;

const bpsSchema = z.number().int().min(0).max(10_000);
const sourceIdsSchema = z.array(catalogIdSchema).max(10).refine(unique);
export const ruleCapSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('spend'),
    amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS),
    period: z.enum(CAP_PERIODS),
    rateAfterCapBps: bpsSchema,
  }),
  z.strictObject({ kind: z.literal('unstated') }),
]);
export const rewardRuleV2Schema = z.strictObject({
  id: catalogIdSchema,
  category: z.enum(REWARD_CATEGORIES),
  issuerWording: z.string().min(1).max(200),
  rateBps: bpsSchema,
  paidOnPaymentBps: bpsSchema,
  cap: ruleCapSchema,
  activation: z.enum(['none', 'enroll-once', 'recurring', 'unstated']),
  usMerchantsOnly: z.boolean(),
  excludedPaymentPaths: z.array(z.enum(PAYMENT_PATHS)).max(4).refine(unique),
  limitedTime: z.strictObject({ endsOn: z.iso.date().nullable() }).nullable(),
  sourceIds: sourceIdsSchema.min(1),
});
export const cardProductV2Schema = z.strictObject({
  id: catalogIdSchema,
  name: z.string().min(1).max(120),
  shortName: z.string().min(1).max(60),
  issuer: z.string().min(1).max(80),
  rewardCurrency: z.enum(['cash-back', 'points']),
  pointValueHundredthsOfCent: z.number().int().min(1).max(10_000).nullable(),
  rules: z.array(rewardRuleV2Schema).min(1).max(20),
  exclusions: z.array(z.string().min(1).max(600)).max(20),
});
export const merchantProfileSchema = z.strictObject({
  id: catalogIdSchema,
  name: z.string().min(1).max(120),
  onlineRetail: z.boolean(),
  physicalGoods: z.boolean(),
  usMerchant: z.boolean(),
  expectedCategory: z.enum(MERCHANT_CATEGORIES),
  mcc: z.strictObject({
    code: z
      .string()
      .regex(/^[0-9]{4}$/)
      .nullable(),
    confidence: z.enum(['low', 'medium', 'high']),
    sourceIds: sourceIdsSchema,
  }),
  notes: z.string().max(1000),
});

export const catalogV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    version: versionSchema,
    verifiedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    merchants: z.array(merchantProfileSchema).min(1).max(20),
    sources: z.array(sourceSchema).min(1).max(30),
    cards: z.array(cardProductV2Schema).min(1).max(30),
  })
  .superRefine((catalog, ctx) => {
    const reject: Reject = (message, path = []) => ctx.addIssue({ code: 'custom', message, path });
    commonInvariants(catalog, reject);
    const sourceIds = new Set(catalog.sources.map((s) => s.id));
    if (!unique(catalog.merchants.map((m) => m.id))) reject('Merchant IDs must be unique.', ['merchants']);
    if (!unique(catalog.cards.map((c) => c.id))) reject('Card IDs must be unique.', ['cards']);
    if (!unique(catalog.cards.flatMap((c) => c.rules.map((r) => r.id))))
      reject('Rule IDs must be globally unique.', ['cards']);
    catalog.merchants.forEach((merchant, index) => {
      const path = ['merchants', index, 'mcc'];
      if (merchant.mcc.sourceIds.some((id) => !sourceIds.has(id)))
        reject('Merchant MCC references an absent source.', [...path, 'sourceIds']);
      if (merchant.mcc.code !== null && merchant.mcc.sourceIds.length === 0)
        reject('A stated MCC needs at least one source.', path);
      if (merchant.mcc.code === null && merchant.mcc.confidence !== 'low')
        reject('An unknown MCC can only have low confidence.', path);
    });
    catalog.cards.forEach((card, index) => {
      const path = ['cards', index];
      if ((card.rewardCurrency === 'points') !== (card.pointValueHundredthsOfCent !== null))
        reject('Points cards need a point value; cash-back cards must not have one.', [
          ...path,
          'pointValueHundredthsOfCent',
        ]);
      const bases = card.rules.filter((r) => r.category === 'all-purchases');
      const base = bases[0];
      if (
        bases.length !== 1 ||
        base.cap.kind === 'spend' ||
        base.activation === 'enroll-once' ||
        base.activation === 'recurring' ||
        base.limitedTime !== null ||
        base.excludedPaymentPaths.length > 0
      )
        reject('A card needs exactly one all-purchases rule with no spend cap, activation, or time limit.', [
          ...path,
          'rules',
        ]);
      card.rules.forEach((rule, i) => {
        const rulePath = [...path, 'rules', i];
        if (base && rule.rateBps < base.rateBps) reject('Bonus rate cannot be below the base.', rulePath);
        if (rule.paidOnPaymentBps > rule.rateBps)
          reject('The paid-on-payment portion cannot exceed the rate.', [...rulePath, 'paidOnPaymentBps']);
        if (rule.cap.kind === 'spend' && rule.cap.rateAfterCapBps > rule.rateBps)
          reject('The after-cap rate cannot exceed the rule rate.', [...rulePath, 'cap']);
        if (rule.sourceIds.some((id) => !sourceIds.has(id)))
          reject('Rule references an absent source.', [...rulePath, 'sourceIds']);
      });
    });
  }) satisfies z.ZodType<CatalogV2>;

/** Either schema version, keyed by `schemaVersion`. Old cached v1 releases stay readable. */
export const catalogSchema = z.discriminatedUnion('schemaVersion', [
  catalogV1Schema,
  catalogV2Schema,
]) satisfies z.ZodType<Catalog>;

/** Wire format from the public release API. Hash identifies the database JSONB payload;
 * it is not a signature. HTTPS and the configured publisher establish origin. */
export const publishedReleaseSchema = z
  .strictObject({
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    catalog: catalogSchema,
    version: z.string().min(1).max(80),
    catalog_hash: z.string().regex(/^[a-f0-9]{64}$/),
    published_at: z.iso.datetime({ offset: true }),
  })
  .superRefine((release, ctx) => {
    if (release.version !== release.catalog.version)
      ctx.addIssue({ code: 'custom', message: 'Release version disagrees with catalog version.' });
    const published = Date.parse(release.published_at);
    if (
      published < Date.parse(release.catalog.verifiedAt) ||
      published >= Date.parse(release.catalog.expiresAt)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Release was not published during its validity window.' });
    }
  });
export type PublishedRelease = z.infer<typeof publishedReleaseSchema>;
export const catalogResponseSchema = z.strictObject({ release: publishedReleaseSchema.nullable() });

/** Stable local equality, not PostgreSQL JSONB hashing or an external signing format. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
