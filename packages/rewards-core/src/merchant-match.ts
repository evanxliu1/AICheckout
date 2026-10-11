// Zod-free and catalog-free, like generic-merchant.ts, so the extension's content scripts can import it.
import { MERCHANT_CATEGORIES_V3, type MerchantProfileV3, type MerchantRecord } from './types.ts';

/** Authored host → record. Hosts are unique across a release, so the index holds one record per host. */
export type MerchantIndex = Map<string, MerchantRecord>;

/** The hostname a URL is matched on: lowercase, punycode (as the URL parser gives it), no trailing dot.
 * Null for anything that never matches a store: non-http(s) URLs, IP addresses, `localhost` and other
 * single-label hosts, unparsable input. */
export function merchantHost(url: string | URL): string | null {
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || /^\d+(\.\d+)*$/.test(host)) return null;
  return host;
}

/** Builds the lookup once per release. A host authored twice (the schema forbids it, so this is defence in
 * depth) goes to the processor record, so a payment page is never shown as a store. */
export function buildMerchantIndex(records: readonly MerchantRecord[]): MerchantIndex {
  const index: MerchantIndex = new Map();
  for (const record of records)
    for (const authored of record.hosts) {
      const host = authored.toLowerCase().replace(/\.$/, '');
      const existing = index.get(host);
      if (!existing || (record.kind === 'processor' && existing.kind !== 'processor'))
        index.set(host, record);
    }
  return index;
}

/** The record whose host is the longest label-boundary suffix of the URL's hostname (`secure.newegg.com`
 * matches `newegg.com`; `notnewegg.com` and `amazon.ca` do not match `amazon.com`), with the host that
 * matched. Country domains must be authored explicitly. `disabled` records match; the caller falls back
 * to the generic profile for them. */
export function matchMerchant(
  index: MerchantIndex,
  url: string | URL,
): { record: MerchantRecord; host: string } | null {
  const host = merchantHost(url);
  if (host === null) return null;
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i += 1) {
    const candidate = labels.slice(i).join('.');
    const record = index.get(candidate);
    if (record) return { record, host: candidate };
  }
  return null;
}

/** The profile the engine should use for a matched record, given the catalog in effect. A `default` record
 * asserts nothing about the store, so where the catalog authors its own profile for that id (the three
 * legacy stores) the catalog's profile stands; a record with evidence, or one the catalog does not know,
 * becomes the profile (`recordToProfile`). Transitional (decision 2026-10-11): it retires itself once 14.4
 * gives those stores evidence. */
export function releaseProfileFor(
  record: MerchantRecord,
  catalog: { brands: readonly { id: string }[]; merchants: readonly MerchantProfileV3[] },
): MerchantProfileV3 {
  if (record.evidence.basis === 'default') {
    const authored = catalog.merchants.find((m) => m.id === record.id);
    if (authored) return authored;
  }
  return recordToProfile(record, catalog);
}

/** The engine profile for a matched record: an online U.S. store (every record is one in this release),
 * the record's goods flag and category, and its brands filtered to the catalog in effect. A brand the
 * catalog does not know is ignored and a category it does not know becomes `general-merchandise`, so a
 * newer release never breaks an older extension. Processors and disabled records are the caller's
 * decision, not this function's. */
export function recordToProfile(
  record: MerchantRecord,
  catalog: { brands: readonly { id: string }[] },
): MerchantProfileV3 {
  const known = new Set(catalog.brands.map((b) => b.id));
  return {
    id: record.id,
    name: record.name,
    onlineRetail: true,
    physicalGoods: record.physicalGoods,
    usMerchant: true,
    expectedCategory: (MERCHANT_CATEGORIES_V3 as readonly string[]).includes(record.category)
      ? record.category
      : 'general-merchandise',
    mcc: { code: null, confidence: 'low', sourceIds: [] },
    notes: '',
    brandIds: record.brandIds.filter((id) => known.has(id)),
  };
}
