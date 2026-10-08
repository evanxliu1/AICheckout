// Currency evidence (generic-reader-protocol, Currency evidence): (a) a code in the row, (b) consistent structured
// data on the page, (c) an unambiguous symbol, (d) the storefront's currency from the page URL's country TLD for a
// shared symbol or no marker, unless the page's language points elsewhere. `lang` alone never decides.

/** ISO 4217 minor-unit exponents (evals/merchants/currency-minor-units.json, currency-minor-units.1). */
export const MINOR_UNITS: Record<string, number> = {
  AED: 2,
  ARS: 2,
  AUD: 2,
  BDT: 2,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CLP: 0,
  CNY: 2,
  COP: 2,
  CZK: 2,
  DKK: 2,
  EGP: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  HUF: 2,
  IDR: 2,
  ILS: 2,
  INR: 2,
  JPY: 0,
  KES: 2,
  KRW: 0,
  KZT: 2,
  MXN: 2,
  MYR: 2,
  NGN: 2,
  NOK: 2,
  NZD: 2,
  PEN: 2,
  PKR: 2,
  PLN: 2,
  RON: 2,
  SAR: 2,
  SEK: 2,
  SGD: 2,
  THB: 2,
  TRY: 2,
  TWD: 2,
  UAH: 2,
  USD: 2,
  VND: 0,
  ZAR: 2,
};
export const isCode = (c: string): boolean => c in MINOR_UNITS;

/** Country TLD to the currency used there (single-currency countries only). */
const TLD_CURRENCY: Record<string, string> = {
  us: 'USD',
  ca: 'CAD',
  au: 'AUD',
  nz: 'NZD',
  mx: 'MXN',
  ar: 'ARS',
  br: 'BRL',
  cl: 'CLP',
  pe: 'PEN',
  uk: 'GBP',
  gb: 'GBP',
  jp: 'JPY',
  cn: 'CNY',
  kr: 'KRW',
  in: 'INR',
  tw: 'TWD',
  hk: 'HKD',
  sg: 'SGD',
  th: 'THB',
  id: 'IDR',
  my: 'MYR',
  vn: 'VND',
  bd: 'BDT',
  pk: 'PKR',
  kz: 'KZT',
  za: 'ZAR',
  ng: 'NGN',
  ke: 'KES',
  eg: 'EGP',
  sa: 'SAR',
  ae: 'AED',
  il: 'ILS',
  tr: 'TRY',
  ua: 'UAH',
  pl: 'PLN',
  cz: 'CZK',
  hu: 'HUF',
  ro: 'RON',
  se: 'SEK',
  no: 'NOK',
  dk: 'DKK',
  ch: 'CHF',
  de: 'EUR',
  fr: 'EUR',
  it: 'EUR',
  es: 'EUR',
  nl: 'EUR',
  be: 'EUR',
  at: 'EUR',
  ie: 'EUR',
  fi: 'EUR',
  pt: 'EUR',
  gr: 'EUR',
  lu: 'EUR',
  sk: 'EUR',
  si: 'EUR',
  ee: 'EUR',
  lv: 'EUR',
  lt: 'EUR',
  mt: 'EUR',
  cy: 'EUR',
  hr: 'EUR',
};

/** Which ambiguous markers a storefront currency can be written with. */
const SHARED_FOR: Record<string, string[]> = {
  $: ['USD', 'CAD', 'AUD', 'NZD', 'MXN', 'ARS', 'CLP', 'HKD', 'SGD', 'TWD', 'COP'],
  '¥': ['JPY', 'CNY'],
  kr: ['SEK', 'NOK', 'DKK'],
  R: ['ZAR'],
  Rs: ['INR', 'PKR'],
  '﷼': ['SAR'],
};

export type Storefront = {
  /** Currency of the URL's country TLD, or null for generic TLDs (.com, .net, .org, .co, ...). */
  tld: string | null;
  /** Primary language subtag and region of the document's `lang`, lower-cased. */
  lang: string;
  region: string;
};

export function storefrontOf(url: string, lang: string): Storefront {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = '';
  }
  const last = host.split('.').pop() ?? '';
  const [primary = '', region = ''] = lang.toLowerCase().split(/[-_]/);
  return { tld: TLD_CURRENCY[last] ?? null, lang: primary, region };
}

/**
 * Rule (b): a currency code from the page's structured data (JSON-LD, currency meta tags, microdata, currency data
 * attributes). Null when there is none or they disagree.
 */
export function structuredCurrency(doc: Document): string | null {
  const found = new Set<string>();
  const add = (v: string | null | undefined) => {
    const c = v?.trim().toUpperCase();
    if (c && isCode(c)) found.add(c);
  };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]'))
    for (const m of (s.textContent ?? '').matchAll(
      /"(?:priceCurrency|currency|currencyCode)"\s*:\s*"([A-Za-z]{3})"/g,
    ))
      add(m[1]);
  for (const m of doc.querySelectorAll(
    'meta[property*="currenc" i], meta[name*="currenc" i], meta[itemprop*="currenc" i]',
  ))
    add(m.getAttribute('content'));
  for (const el of doc.querySelectorAll('[itemprop="priceCurrency"]'))
    add(el.getAttribute('content') ?? el.textContent);
  for (const el of doc.querySelectorAll('*')) {
    if (!el.hasAttributes()) continue;
    for (const name of el.getAttributeNames())
      if (name.startsWith('data-') && /currenc/i.test(name)) {
        const v = el.getAttribute(name) ?? '';
        if (/^[A-Za-z]{3}$/.test(v)) add(v);
      }
  }
  return found.size === 1 ? [...found][0]! : null;
}

export type RowCurrencyEvidence = {
  /** Distinct ISO codes written in the row (rule (a)). */
  codes: string[];
  /** Deciding currency from a symbol in the row (rule (c)), `'shared'`, or null when there is no marker. */
  marker: string | null;
  /** The shared marker's text, when `marker === 'shared'`. */
  sharedText: string | null;
};

/** Resolves the row's currency by the evidence order, or null when it is undetermined. */
export function resolveCurrency(
  row: RowCurrencyEvidence,
  structured: string | null,
  store: Storefront,
): string | null {
  if (row.codes.length > 1) return null;
  if (row.codes.length === 1) return row.codes[0]!;
  if (structured) return structured;
  if (row.marker && row.marker !== 'shared') return row.marker;
  // Rule (d): the storefront, only for a shared marker or no marker, and only when nothing points elsewhere.
  if (row.marker === 'shared') {
    const key = row.sharedText?.replace(/\.$/, '').replace('￥', '¥').replace('₨', 'Rs') ?? '';
    const options = SHARED_FOR[key] ?? [];
    if (store.tld) return options.includes(store.tld) ? store.tld : null;
    // Generic TLD: a bare `$` is USD only on an English page with no other region.
    if (
      key === '$' &&
      (store.lang === '' || store.lang === 'en') &&
      (store.region === '' || store.region === 'us')
    )
      return 'USD';
    return null;
  }
  return store.tld;
}
