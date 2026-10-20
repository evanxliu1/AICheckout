// The tab's store against the merchant release (Phase 14.2). Worker and extension pages only: the
// content scripts never carry the release (it is refreshed in the worker from 14.6 on, and ~500 records
// on every https page would be waste); they send the generic id on every page, and the worker resolves
// the store from the sender URL.
import { GENERIC_MERCHANT_ID, GENERIC_MERCHANT_PROFILE } from '@ai-checkout/rewards-core/generic-merchant';
import {
  buildMerchantIndex,
  matchMerchant,
  releaseProfileFor,
} from '@ai-checkout/rewards-core/merchant-match';
import type { MerchantIndex } from '@ai-checkout/rewards-core/merchant-match';
import { MERCHANTS_V1 } from '@ai-checkout/rewards-core/merchants-v1';
import { CATALOG_V3 } from '@ai-checkout/rewards-core';
import type {
  Catalog,
  CatalogV3,
  MerchantProfileV3,
  MerchantRecord,
  MerchantRelease,
} from '@ai-checkout/rewards-core';

/** The release in effect in this document: the bundled one until a page calls `setMerchantsInEffect` with the
 * cached hosted release when it is newer (Phase 14.6, `state/merchants-page.ts`). The worker does not use
 * this default: it reads the cache on every request and passes the release explicitly. */
let inEffect: MerchantRelease = MERCHANTS_V1;
export function setMerchantsInEffect(release: MerchantRelease) {
  inEffect = release;
}
// Each release is indexed once (the bundled one, the one in effect and any a test passes).
const indexes = new WeakMap<MerchantRelease, MerchantIndex>();
const indexOf = (release: MerchantRelease): MerchantIndex => {
  let index = indexes.get(release);
  if (!index) {
    index = buildMerchantIndex(release.merchants);
    indexes.set(release, index);
  }
  return index;
};
/** The release record with this id, if any. */
export const releaseRecord = (id: string, release: MerchantRelease = inEffect): MerchantRecord | undefined =>
  release.merchants.find((m) => m.id === id);

/** The name shown for a store id: the generic store, or the release record's name (Phase 14.2; since
 * Phase 15.1 the release names every store, `amazon-us` included). */
export function merchantName(id: string): string {
  if (id === GENERIC_MERCHANT_ID) return GENERIC_MERCHANT_PROFILE.name;
  return releaseRecord(id)?.name ?? 'Unsupported merchant';
}

/** What a tab URL resolves to against the merchant release. `store`: a matched record (a merchant or
 * marketplace); `generic`: no record, or a `disabled` one, so the engine's generic profile; `processor`:
 * a payment page (no badge, no reader; the popup says it cannot compare there). */
export interface TabStore {
  kind: 'store' | 'generic' | 'processor';
  /** The record's id, or `generic-us-online`. */
  id: string;
  /** The tab's hostname (lower case, no trailing dot): the per-site switch's key. Never the path. */
  host: string;
  name: string;
}

/** The store of a tab URL (Phase 14.2): the bundled release matched on the device by label-boundary host
 * suffix (`secure.newegg.com` → `newegg-us`; `amazon.ca` never `amazon-us`), any other web page the engine's
 * generic store, and null for a non-web page. The URL is never stored. */
export function storeForTab(
  rawUrl: string | undefined,
  release: MerchantRelease = inEffect,
): TabStore | null {
  let url: URL;
  try {
    url = new URL(rawUrl ?? '');
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const match = matchMerchant(indexOf(release), url);
  if (match && match.record.kind === 'processor')
    return { kind: 'processor', id: match.record.id, host, name: match.record.name };
  if (match && !match.record.disabled)
    return { kind: 'store', id: match.record.id, host, name: match.record.name };
  return { kind: 'generic', id: GENERIC_MERCHANT_ID, host, name: GENERIC_MERCHANT_PROFILE.name };
}

/** The merchant a reading of this tab names: the matched store or the generic store; null for a non-web
 * page and for a payment processor's page, where nothing is read. */
export function merchantForTab(
  rawUrl: string | undefined,
  release: MerchantRelease = inEffect,
): string | null {
  const store = storeForTab(rawUrl, release);
  return store && store.kind !== 'processor' ? store.id : null;
}

/** The engine profile for a store id under a catalog v3: the release record's (`releaseProfileFor`: a
 * `default` record defers to a profile the catalog authors), else the catalog's own, else the generic
 * profile for the generic id. Undefined for processors, disabled records, unknown ids and v1/v2 catalogs
 * (the engine then answers as before). */
export function storeProfile(
  catalog: Catalog,
  merchantId: string,
  release: MerchantRelease = inEffect,
): MerchantProfileV3 | undefined {
  if (catalog.schemaVersion !== 3) return undefined;
  const record = releaseRecord(merchantId, release);
  if (record && record.kind !== 'processor' && !record.disabled) return releaseProfileFor(record, catalog);
  return (
    catalog.merchants.find((m) => m.id === merchantId) ??
    (merchantId === GENERIC_MERCHANT_ID ? GENERIC_MERCHANT_PROFILE : undefined)
  );
}

/** The `compareRewards` option for a store: its profile, so a release record stands in for the catalog's. */
export const merchantOption = (
  catalog: Catalog,
  merchantId: string,
  release: MerchantRelease = inEffect,
): { merchant?: MerchantProfileV3 } => ({ merchant: storeProfile(catalog, merchantId, release) });

const CATEGORY_WORDING: Record<MerchantRecord['category'], string | null> = {
  'general-merchandise': null,
  electronics: 'an electronics store',
  supermarkets: 'a supermarket',
  gas: 'a gas station',
  'ev-charging': 'an EV charging network',
  dining: 'a restaurant',
  drugstores: 'a drugstore',
  entertainment: 'entertainment',
  streaming: 'a streaming service',
  transit: 'transit',
  'department-stores': 'a department store',
  'home-improvement': 'a home-improvement store',
  'wholesale-clubs': 'a wholesale club',
};
/** The issuer whose terms a cited issuer source is: the catalog card citing that source id (the release reuses
 * the catalog's source ids for issuer pages), else null. */
const issuerOf = (sourceId: string, catalog: CatalogV3): string | null =>
  catalog.cards.find((card) => card.rules.some((rule) => rule.sourceIds.includes(sourceId)))?.issuer ?? null;

/** Why a bonus category applies at a matched store: the record's category with its evidence basis. Null
 * for a `default` record (it claims no category), the generic store and any id the release lacks.
 * A `definition` record reads "Treated as", naming the issuer whose category definition the store's own pages fit
 * ("Codes as" is for `issuer`, `mcc` and `corroborated`; an `mcc` record reads "Codes as dining in public
 * purchase-card data (mostly in-store)", the openly licensed government datasets, 2026-10-11); no partnership is
 * implied. */
export function storeEvidence(
  merchantId: string,
  release: MerchantRelease = inEffect,
  catalog: CatalogV3 = CATALOG_V3,
): string | null {
  const record = releaseRecord(merchantId, release);
  if (!record || record.evidence.basis === 'default' || record.disabled) return null;
  const wording = CATEGORY_WORDING[record.category];
  if (!wording) return null;
  if (record.evidence.basis === 'definition') {
    const issuerSources = new Set(release.sources.filter((s) => s.kind === 'issuer-terms').map((s) => s.id));
    const issuers = [
      ...new Set(
        record.evidence.sourceIds
          .filter((id) => issuerSources.has(id))
          .map((id) => issuerOf(id, catalog))
          .filter((name): name is string => name !== null),
      ),
    ];
    const list = issuers.length > 1 ? `${issuers.slice(0, -1).join(', ')} and ${issuers.at(-1)}` : issuers[0];
    const whose = issuers.length ? `${list}'s` : "an issuer's";
    const noun = wording.replace(/^an? /, '');
    return `Treated as ${wording} (its own pages; fits ${whose} ${noun} definition).`;
  }
  if (record.evidence.basis === 'mcc')
    return `Codes as ${wording} in public purchase-card data (mostly in-store).`;
  const basis =
    record.evidence.basis === 'issuer'
      ? 'named in card terms'
      : 'its own store pages and a public merchant-code lookup agree';
  return `Codes as ${wording} (${basis}).`;
}
