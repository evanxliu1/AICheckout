import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from './money.ts';
import { isUnconditionalRuleV3 } from './rules-v3.ts';
import {
  CAP_PERIODS,
  MERCHANT_CATEGORIES,
  EXCLUDABLE_PAYMENT_PATHS,
  REWARD_CATEGORIES,
  REWARD_CATEGORIES_V3,
  MERCHANT_CATEGORIES_V3,
  PAYMENT_PATHS_V3,
  EXCLUDABLE_PAYMENT_PATHS_V3,
  type Catalog,
  type CatalogV1,
  type CatalogV2,
  type CatalogV3,
} from './types.ts';

/** Size limit for catalog schemas 1 and 2. */
export const MAX_CATALOG_BYTES = 262_144;
/** Catalog schema 3 limits, mirrored in `catalog_private.valid_catalog_v3`. */
export const CATALOG_V3_LIMITS = {
  bytes: 1_048_576,
  cards: 300,
  sources: 600,
  merchants: 100,
  brands: 400,
  programs: 100,
  gates: 100,
  rulesPerCard: 30,
} as const;
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

/** Checks shared by every schema version: validity window, source dates, unique IDs, size. */
function commonInvariants(
  catalog: { verifiedAt: string; expiresAt: string; sources: { id: string; checkedOn: string }[] },
  reject: Reject,
  maxBytes: number = MAX_CATALOG_BYTES,
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
  if (new TextEncoder().encode(JSON.stringify(catalog)).byteLength > maxBytes)
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
  excludedPaymentPaths: z.array(z.enum(EXCLUDABLE_PAYMENT_PATHS)).max(3).refine(unique),
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
        if (base && rule.cap.kind === 'spend' && rule.cap.rateAfterCapBps < base.rateBps)
          reject('The after-cap rate cannot be below the base rate.', [...rulePath, 'cap']);
        if (rule.sourceIds.some((id) => !sourceIds.has(id)))
          reject('Rule references an absent source.', [...rulePath, 'sourceIds']);
      });
    });
  }) satisfies z.ZodType<CatalogV2>;

const optionSchema = z.strictObject({ id: catalogIdSchema, label: z.string().min(1).max(120) });
const idListSchema = (max: number) => z.array(catalogIdSchema).max(max).refine(unique);
const httpsUrlSchema = sourceSchema.shape.url;
export const programValuationSchema = z.discriminatedUnion('basis', [
  z.strictObject({ basis: z.literal('cash'), valueHundredthsOfCent: z.literal(100) }),
  z.strictObject({
    basis: z.literal('published-estimate'),
    valueHundredthsOfCent: z.number().int().min(1).max(10_000),
    publisher: z.string().min(1).max(120),
    url: httpsUrlSchema,
    retrievedOn: z.iso.date(),
  }),
  z.strictObject({
    basis: z.literal('issuer-stated'),
    valueHundredthsOfCent: z.number().int().min(1).max(10_000),
    sourceIds: sourceIdsSchema.min(1),
  }),
  z.strictObject({ basis: z.literal('none') }),
]);
export const rewardProgramSchema = z.strictObject({
  id: catalogIdSchema,
  name: z.string().min(1).max(120),
  currency: z.enum(['cash-back', 'points']),
  unitName: z.string().min(1).max(60),
  valuation: programValuationSchema,
  redemptionBrandIds: idListSchema(20),
});
export const brandSchema = z.strictObject({ id: catalogIdSchema, name: z.string().min(1).max(120) });
export const gateSchema = z.strictObject({
  id: catalogIdSchema,
  question: z.string().min(1).max(200),
  options: z.array(optionSchema).min(2).max(10),
});
export const cardChoiceSchema = z.strictObject({
  id: catalogIdSchema,
  kind: z.enum(['chosen', 'automatic']),
  label: z.string().min(1).max(200),
  picks: z.number().int().min(1).max(5),
  options: z.array(optionSchema).min(2).max(30),
  defaultOptionIds: idListSchema(5),
});
export const rewardRuleV3Schema = z.strictObject({
  ...rewardRuleV2Schema.shape,
  category: z.enum(REWARD_CATEGORIES_V3),
  excludedPaymentPaths: z.array(z.enum(EXCLUDABLE_PAYMENT_PATHS_V3)).max(4).refine(unique),
  limitedTime: z
    .strictObject({ startsOn: z.iso.date().nullable(), endsOn: z.iso.date().nullable() })
    .nullable(),
  brandIds: idListSchema(20),
  excludedBrandIds: idListSchema(20),
  sharedCapId: catalogIdSchema.nullable(),
  choice: z.strictObject({ choiceId: catalogIdSchema, optionId: catalogIdSchema }).nullable(),
  requires: z.array(z.strictObject({ gateId: catalogIdSchema, optionIds: idListSchema(10).min(1) })).max(5),
  requiredPaymentPaths: z.array(z.enum(PAYMENT_PATHS_V3)).max(5).refine(unique),
});
export const cardProductV3Schema = z.strictObject({
  id: catalogIdSchema,
  name: z.string().min(1).max(120),
  shortName: z.string().min(1).max(60),
  issuer: z.string().min(1).max(80),
  programId: catalogIdSchema,
  statedValueHundredthsOfCent: z.number().int().min(1).max(10_000).nullable(),
  acceptance: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('open-loop') }),
    z.strictObject({ kind: z.literal('closed-loop'), brandIds: idListSchema(20).min(1) }),
  ]),
  choices: z.array(cardChoiceSchema).max(5),
  rules: z.array(rewardRuleV3Schema).min(1).max(CATALOG_V3_LIMITS.rulesPerCard),
  exclusions: z.array(z.string().min(1).max(600)).max(20),
});
export const merchantProfileV3Schema = z.strictObject({
  ...merchantProfileSchema.shape,
  expectedCategory: z.enum(MERCHANT_CATEGORIES_V3),
  brandIds: idListSchema(20),
});

/** A v3 rule with no condition of any kind (zod-free, in rules-v3.ts so the engine can use it). */
export { isUnconditionalRuleV3 };

const DAY_MS = 24 * 60 * 60 * 1000;
export const catalogV3Schema = z
  .strictObject({
    schemaVersion: z.literal(3),
    version: versionSchema,
    verifiedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    programs: z.array(rewardProgramSchema).min(1).max(CATALOG_V3_LIMITS.programs),
    brands: z.array(brandSchema).max(CATALOG_V3_LIMITS.brands),
    gates: z.array(gateSchema).max(CATALOG_V3_LIMITS.gates),
    merchants: z.array(merchantProfileV3Schema).min(1).max(CATALOG_V3_LIMITS.merchants),
    sources: z.array(sourceSchema).min(1).max(CATALOG_V3_LIMITS.sources),
    cards: z.array(cardProductV3Schema).min(1).max(CATALOG_V3_LIMITS.cards),
  })
  .superRefine((catalog, ctx) => {
    const reject: Reject = (message, path = []) => ctx.addIssue({ code: 'custom', message, path });
    commonInvariants(catalog, reject, CATALOG_V3_LIMITS.bytes);
    const sourceIds = new Set(catalog.sources.map((s) => s.id));
    const brandIds = new Set(catalog.brands.map((b) => b.id));
    const programs = new Map(catalog.programs.map((p) => [p.id, p]));
    const gates = new Map(catalog.gates.map((g) => [g.id, g]));
    const missing = (ids: string[], known: Set<string>) => ids.some((id) => !known.has(id));
    for (const [list, name] of [
      [catalog.programs, 'programs'],
      [catalog.brands, 'brands'],
      [catalog.gates, 'gates'],
      [catalog.merchants, 'merchants'],
      [catalog.cards, 'cards'],
    ] as const)
      if (!unique(list.map((item) => item.id))) reject(`IDs in ${name} must be unique.`, [name]);
    if (!unique(catalog.cards.flatMap((c) => c.rules.map((r) => r.id))))
      reject('Rule IDs must be globally unique.', ['cards']);

    const verifiedOn = Date.parse(`${catalog.verifiedAt.slice(0, 10)}T00:00:00Z`);
    const expiresOn = Date.parse(`${catalog.expiresAt.slice(0, 10)}T00:00:00Z`);
    catalog.programs.forEach((program, index) => {
      const path = ['programs', index];
      const { valuation } = program;
      if ((program.currency === 'cash-back') !== (valuation.basis === 'cash'))
        reject('Cash-back programs, and only they, are valued as cash.', [...path, 'valuation']);
      if (valuation.basis === 'issuer-stated' && missing(valuation.sourceIds, sourceIds))
        reject('Program value references an absent source.', [...path, 'valuation', 'sourceIds']);
      if (valuation.basis === 'published-estimate') {
        const read = Date.parse(`${valuation.retrievedOn}T00:00:00Z`);
        if (read < verifiedOn - 30 * DAY_MS || read > expiresOn)
          reject('A published estimate must be read within 30 days before verification and before expiry.', [
            ...path,
            'valuation',
            'retrievedOn',
          ]);
      }
      if (missing(program.redemptionBrandIds, brandIds))
        reject('Program references an absent brand.', [...path, 'redemptionBrandIds']);
    });
    catalog.gates.forEach((gate, index) => {
      if (!unique(gate.options.map((o) => o.id))) reject('Gate option IDs must be unique.', ['gates', index]);
    });
    catalog.merchants.forEach((merchant, index) => {
      const path = ['merchants', index];
      if (missing(merchant.brandIds, brandIds))
        reject('Merchant references an absent brand.', [...path, 'brandIds']);
      if (missing(merchant.mcc.sourceIds, sourceIds))
        reject('Merchant MCC references an absent source.', [...path, 'mcc', 'sourceIds']);
      if (merchant.mcc.code !== null && merchant.mcc.sourceIds.length === 0)
        reject('A stated MCC needs at least one source.', [...path, 'mcc']);
      if (merchant.mcc.code === null && merchant.mcc.confidence !== 'low')
        reject('An unknown MCC can only have low confidence.', [...path, 'mcc']);
    });

    catalog.cards.forEach((card, index) => {
      const path = ['cards', index];
      const program = programs.get(card.programId);
      if (!program) reject('Card references an absent program.', [...path, 'programId']);
      if (card.statedValueHundredthsOfCent !== null && program?.currency !== 'points')
        reject('Only points programs can have an issuer-stated card value.', [
          ...path,
          'statedValueHundredthsOfCent',
        ]);
      if (card.acceptance.kind === 'closed-loop' && missing(card.acceptance.brandIds, brandIds))
        reject('Closed-loop card references an absent brand.', [...path, 'acceptance']);
      const choices = new Map(card.choices.map((c) => [c.id, c]));
      if (choices.size !== card.choices.length)
        reject('Choice IDs must be unique within a card.', [...path, 'choices']);
      card.choices.forEach((choice, i) => {
        const optionIds = new Set(choice.options.map((o) => o.id));
        if (
          optionIds.size !== choice.options.length ||
          choice.picks >= choice.options.length ||
          choice.defaultOptionIds.length > choice.picks ||
          missing(choice.defaultOptionIds, optionIds) ||
          (choice.kind === 'automatic' && choice.defaultOptionIds.length > 0)
        )
          reject('A choice needs unique options, fewer picks than options and valid defaults.', [
            ...path,
            'choices',
            i,
          ]);
      });
      const bases = card.rules.filter((r) => r.category === 'all-purchases' && isUnconditionalRuleV3(r));
      const base = bases[0];
      if (card.acceptance.kind === 'open-loop' ? bases.length !== 1 : bases.length > 1)
        reject(
          'An open-loop card needs exactly one unconditional all-purchases rule; a closed-loop card at most one.',
          [...path, 'rules'],
        );
      card.rules.forEach((rule, i) => {
        const rulePath = [...path, 'rules', i];
        if (base && rule.rateBps < base.rateBps) reject('Bonus rate cannot be below the base.', rulePath);
        if (rule.paidOnPaymentBps > rule.rateBps)
          reject('The paid-on-payment portion cannot exceed the rate.', [...rulePath, 'paidOnPaymentBps']);
        if (rule.cap.kind === 'spend' && rule.cap.rateAfterCapBps > rule.rateBps)
          reject('The after-cap rate cannot exceed the rule rate.', [...rulePath, 'cap']);
        if (base && rule.cap.kind === 'spend' && rule.cap.rateAfterCapBps < base.rateBps)
          reject('The after-cap rate cannot be below the base rate.', [...rulePath, 'cap']);
        if (missing(rule.sourceIds, sourceIds))
          reject('Rule references an absent source.', [...rulePath, 'sourceIds']);
        if (missing(rule.brandIds, brandIds))
          reject('Rule references an absent brand.', [...rulePath, 'brandIds']);
        if (missing(rule.excludedBrandIds, brandIds))
          reject('Rule excludes an absent brand.', [...rulePath, 'excludedBrandIds']);
        if (rule.excludedBrandIds.some((id) => rule.brandIds.includes(id)))
          reject('A brand cannot be both in scope and excluded.', [...rulePath, 'excludedBrandIds']);
        if (rule.sharedCapId !== null) {
          const shared = card.rules.find((r) => r.sharedCapId === rule.sharedCapId)!;
          if (
            rule.cap.kind !== 'spend' ||
            shared.cap.kind !== 'spend' ||
            rule.cap.amountCents !== shared.cap.amountCents ||
            rule.cap.period !== shared.cap.period
          )
            reject('Rules sharing a cap need spend caps with the same amount and period.', [
              ...rulePath,
              'sharedCapId',
            ]);
        }
        const { startsOn, endsOn } = rule.limitedTime ?? { startsOn: null, endsOn: null };
        if (startsOn !== null && endsOn !== null && startsOn > endsOn)
          reject('A limited-time rule cannot end before it starts.', [...rulePath, 'limitedTime']);
        if (rule.choice) {
          const choice = choices.get(rule.choice.choiceId);
          if (!choice?.options.some((o) => o.id === rule.choice?.optionId))
            reject('Rule references an absent choice option.', [...rulePath, 'choice']);
        }
        if (!unique(rule.requires.map((r) => r.gateId)))
          reject('A rule can require each gate once.', [...rulePath, 'requires']);
        rule.requires.forEach((requirement, j) => {
          const gate = gates.get(requirement.gateId);
          if (
            !gate ||
            missing(requirement.optionIds, new Set(gate.options.map((o) => o.id))) ||
            requirement.optionIds.length >= gate.options.length
          )
            reject('A requirement needs a known gate and some, not all, of its options.', [
              ...rulePath,
              'requires',
              j,
            ]);
        });
        if (rule.requiredPaymentPaths.some((p) => (rule.excludedPaymentPaths as string[]).includes(p)))
          reject('A payment path cannot be both required and excluded.', [
            ...rulePath,
            'requiredPaymentPaths',
          ]);
      });
    });
  }) satisfies z.ZodType<CatalogV3>;

/** Any schema version, keyed by `schemaVersion`. Old cached v1 and v2 releases stay readable. */
export const catalogSchema = z.discriminatedUnion('schemaVersion', [
  catalogV1Schema,
  catalogV2Schema,
  catalogV3Schema,
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
