import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from './money.ts';
import type { Catalog } from './types.ts';

export const MAX_CATALOG_BYTES = 262_144;
export const CATALOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const catalogIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
const unique = (values: string[]) => new Set(values).size === values.length;
export const sourceSchema = z.strictObject({
  id: catalogIdSchema, title: z.string().min(1).max(200),
  url: z.url({ protocol: /^https$/ }).max(2048).regex(/^https:\/\/[^\s]+$/).refine(value => {
    try { const url = new URL(value); return !url.username && !url.password; } catch { return false; }
  }, 'Source URLs cannot contain credentials.'),
  checkedOn: z.iso.date(),
});
export const rewardRuleSchema = z.strictObject({
  id: catalogIdSchema, category: z.enum(['all-eligible', 'us-online-retail']),
  rateBps: z.number().int().min(0).max(10_000),
  annualCapCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS).optional(),
  requiresActivation: z.boolean(), sourceIds: z.array(catalogIdSchema).min(1).max(10).refine(unique),
});
export const cardProductSchema = z.strictObject({
  id: catalogIdSchema, name: z.string().min(1).max(120), shortName: z.string().min(1).max(60),
  rules: z.array(rewardRuleSchema).min(1).max(2),
});
export const catalogSchema = z.strictObject({
  schemaVersion: z.literal(1), version: z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  verifiedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  merchantIds: z.array(catalogIdSchema).min(1).max(10).refine(unique),
  sources: z.array(sourceSchema).min(1).max(30), cards: z.array(cardProductSchema).min(1).max(30),
}).superRefine((catalog, ctx) => {
  const reject = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  const verified = Date.parse(catalog.verifiedAt), expires = Date.parse(catalog.expiresAt);
  if (expires <= verified || expires - verified > CATALOG_MAX_AGE_MS) reject('Catalog validity must be between zero and 30 days.', ['expiresAt']);
  const checkedDate = Date.parse(`${catalog.verifiedAt.slice(0, 10)}T00:00:00Z`);
  catalog.sources.forEach((source, i) => {
    const checked = Date.parse(`${source.checkedOn}T00:00:00Z`);
    if (checked > checkedDate || checkedDate - checked > CATALOG_MAX_AGE_MS) reject('Source date must be within 30 days before verification.', ['sources', i, 'checkedOn']);
  });
  if (!unique(catalog.sources.map(s => s.id))) reject('Source IDs must be unique.', ['sources']);
  if (!unique(catalog.cards.map(c => c.id))) reject('Card IDs must be unique.', ['cards']);
  if (!unique(catalog.cards.flatMap(c => c.rules.map(r => r.id)))) reject('Rule IDs must be globally unique.', ['cards']);
  catalog.cards.forEach((card, index) => {
    const bases = card.rules.filter(r => r.category === 'all-eligible');
    const bonuses = card.rules.filter(r => r.category === 'us-online-retail');
    if (bases.length !== 1 || bonuses.length > 1 || bases[0]?.annualCapCents !== undefined || bases[0]?.requiresActivation) {
      reject('A card needs one uncapped, unconditional base and at most one online-retail bonus.', ['cards', index, 'rules']);
    }
    card.rules.forEach((rule, i) => {
      if (bases[0] && rule.rateBps < bases[0].rateBps) reject('Bonus rate cannot be below the base.', ['cards', index, 'rules', i]);
      if (rule.sourceIds.some(id => !catalog.sources.some(s => s.id === id))) reject('Rule references an absent source.', ['cards', index, 'rules', i, 'sourceIds']);
    });
  });
  if (new TextEncoder().encode(JSON.stringify(catalog)).byteLength > MAX_CATALOG_BYTES) reject('Catalog is too large.');
}) satisfies z.ZodType<Catalog>;

/** Wire format from the public release API. Hash identifies the database JSONB payload;
 * it is not a signature. HTTPS and the configured publisher establish origin. */
export const publishedReleaseSchema = z.strictObject({
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  catalog: catalogSchema, version: z.string().min(1).max(80),
  catalog_hash: z.string().regex(/^[a-f0-9]{64}$/), published_at: z.iso.datetime({ offset: true }),
}).superRefine((release, ctx) => {
  if (release.version !== release.catalog.version) ctx.addIssue({ code: 'custom', message: 'Release version disagrees with catalog version.' });
  const published = Date.parse(release.published_at);
  if (published < Date.parse(release.catalog.verifiedAt) || published >= Date.parse(release.catalog.expiresAt)) {
    ctx.addIssue({ code: 'custom', message: 'Release was not published during its validity window.' });
  }
});
export type PublishedRelease = z.infer<typeof publishedReleaseSchema>;
export const catalogResponseSchema = z.strictObject({ release: publishedReleaseSchema.nullable() });

/** Stable local equality, not PostgreSQL JSONB hashing or an external signing format. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
