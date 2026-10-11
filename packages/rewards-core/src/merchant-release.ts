import { z } from 'zod';
import { catalogIdSchema, sourceSchema } from './schema.ts';
import {
  MERCHANT_CATEGORIES_V3,
  MERCHANT_EVIDENCE_BASES,
  MERCHANT_KINDS,
  MERCHANT_SOURCE_KINDS,
  type MerchantRelease,
} from './types.ts';

/** Merchant release schema 1 limits (Phase 14); mirrored in SQL by `valid_merchant_release_v1` (14.6). */
export const MERCHANT_RELEASE_LIMITS = {
  bytes: 2 * 1024 * 1024,
  merchants: 5000,
  sources: 10_000,
  hostsPerMerchant: 20,
  brandsPerMerchant: 20,
  sourcesPerMerchant: 10,
  nameLength: 60,
} as const;

const unique = (values: string[]) => new Set(values).size === values.length;
/** Lowercase DNS labels (punycode included), at least two of them, a TLD that starts with a letter (so
 * an IPv4 address is never a host), no trailing dot. */
export const merchantHostSchema = z
  .string()
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/);
export const merchantSourceSchema = z.strictObject({
  id: catalogIdSchema,
  url: sourceSchema.shape.url,
  kind: z.enum(MERCHANT_SOURCE_KINDS),
  capturedAt: z.iso.date(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const merchantRecordSchema = z.strictObject({
  id: catalogIdSchema,
  name: z
    .string()
    .min(1)
    .max(MERCHANT_RELEASE_LIMITS.nameLength)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 &'.,+-]*$/),
  hosts: z.array(merchantHostSchema).min(1).max(MERCHANT_RELEASE_LIMITS.hostsPerMerchant).refine(unique),
  kind: z.enum(MERCHANT_KINDS),
  physicalGoods: z.boolean(),
  category: z.enum(MERCHANT_CATEGORIES_V3),
  evidence: z.strictObject({
    basis: z.enum(MERCHANT_EVIDENCE_BASES),
    sourceIds: z.array(catalogIdSchema).max(MERCHANT_RELEASE_LIMITS.sourcesPerMerchant).refine(unique),
  }),
  brandIds: z.array(catalogIdSchema).max(MERCHANT_RELEASE_LIMITS.brandsPerMerchant).refine(unique),
  disabled: z.boolean(),
});

/** `merchant-release.1`: a versioned list of known store websites, downloaded whole and matched on the
 * device. Invariants: unique ids, sources and hosts (across every record, so the longest matching host
 * is always one record); every cited source resolves; the evidence rule (`default` cites nothing and
 * is `general-merchandise`; `issuer` cites issuer terms; `corroborated` cites a store page and a
 * merchant-code lookup; `definition` cites a store page and issuer terms, and on a marketplace only for
 * `dining`, where an issuer's definition may name delivery services); every source is cited by some
 * record; a processor sells no physical goods, has `default` evidence and no brands; no source captured
 * after `verifiedAt`; at most 2 MiB. */
export const merchantReleaseSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: z
      .string()
      .max(80)
      .regex(/^\d{4}-\d{2}-\d{2}\.[a-z0-9-]+\.\d+$/),
    verifiedAt: z.iso.datetime(),
    sources: z.array(merchantSourceSchema).max(MERCHANT_RELEASE_LIMITS.sources),
    merchants: z.array(merchantRecordSchema).min(1).max(MERCHANT_RELEASE_LIMITS.merchants),
  })
  .superRefine((release, ctx) => {
    const reject = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });
    const sources = new Map(release.sources.map((s) => [s.id, s]));
    if (sources.size !== release.sources.length) reject('Source IDs must be unique.', ['sources']);
    if (!unique(release.merchants.map((m) => m.id))) reject('Merchant IDs must be unique.', ['merchants']);
    if (!unique(release.merchants.flatMap((m) => m.hosts)))
      reject('Hosts must be unique across merchants.', ['merchants']);
    const verifiedOn = release.verifiedAt.slice(0, 10);
    release.sources.forEach((source, i) => {
      if (source.capturedAt > verifiedOn)
        reject('Source captured after verification.', ['sources', i, 'capturedAt']);
    });
    release.merchants.forEach((merchant, i) => {
      const path = ['merchants', i];
      const kinds = new Set<string>();
      for (const id of merchant.evidence.sourceIds) {
        const source = sources.get(id);
        if (!source) reject(`Unknown source ${id}.`, [...path, 'evidence', 'sourceIds']);
        else kinds.add(source.kind);
      }
      const { basis } = merchant.evidence;
      if (basis === 'default') {
        if (merchant.evidence.sourceIds.length > 0)
          reject('Default evidence cites no sources.', [...path, 'evidence', 'sourceIds']);
        if (merchant.category !== 'general-merchandise')
          reject('A category other than general-merchandise needs evidence.', [...path, 'category']);
      } else if (basis === 'issuer' && !kinds.has('issuer-terms'))
        reject('Issuer evidence cites issuer terms.', [...path, 'evidence', 'sourceIds']);
      else if (basis === 'corroborated' && !(kinds.has('store-page') && kinds.has('mcc-lookup')))
        reject('Corroborated evidence cites a store page and a merchant-code lookup.', [
          ...path,
          'evidence',
          'sourceIds',
        ]);
      else if (basis === 'definition') {
        if (!(kinds.has('store-page') && kinds.has('issuer-terms')))
          reject('Definition evidence cites a store page and issuer terms.', [
            ...path,
            'evidence',
            'sourceIds',
          ]);
        if (merchant.kind === 'marketplace' && merchant.category !== 'dining')
          reject('Definition evidence on a marketplace is for dining only.', [...path, 'category']);
      }
      if (merchant.kind === 'processor') {
        if (merchant.physicalGoods)
          reject('A processor sells no physical goods.', [...path, 'physicalGoods']);
        if (basis !== 'default') reject('A processor has default evidence.', [...path, 'evidence', 'basis']);
        if (merchant.brandIds.length > 0) reject('A processor has no brands.', [...path, 'brandIds']);
      }
    });
    const cited = new Set(release.merchants.flatMap((m) => m.evidence.sourceIds));
    release.sources.forEach((source, i) => {
      if (!cited.has(source.id)) reject(`Source ${source.id} is cited by no record.`, ['sources', i]);
    });
    if (new TextEncoder().encode(JSON.stringify(release)).byteLength > MERCHANT_RELEASE_LIMITS.bytes)
      reject('Merchant release is too large.');
  }) satisfies z.ZodType<MerchantRelease>;

/** A row of `public.merchant_releases` as the API serves it (14.6): the release, its sequence, the
 * database's hash of the stored JSONB text (an identifier, not a signature) and when it was published.
 * Mirrors `publishedReleaseSchema` for catalogs; there is no expiry, so the only window check is that the
 * release was not published before it was verified. */
export const publishedMerchantReleaseSchema = z
  .strictObject({
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    release: merchantReleaseSchema,
    version: z.string().min(1).max(80),
    release_hash: z.string().regex(/^[a-f0-9]{64}$/),
    published_at: z.iso.datetime({ offset: true }),
  })
  .superRefine((row, ctx) => {
    if (row.version !== row.release.version)
      ctx.addIssue({
        code: 'custom',
        message: 'Release version disagrees with the merchant release version.',
      });
    if (Date.parse(row.published_at) < Date.parse(row.release.verifiedAt))
      ctx.addIssue({ code: 'custom', message: 'Release was published before it was verified.' });
  });
export type PublishedMerchantRelease = z.infer<typeof publishedMerchantReleaseSchema>;
/** `GET /v1/merchants`: the head release, or null before the first publication. */
export const merchantsResponseSchema = z.strictObject({ release: publishedMerchantReleaseSchema.nullable() });
