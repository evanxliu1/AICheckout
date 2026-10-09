// Currency evidence (generic-reader-protocol, Currency evidence): (a) a code in the row, (b) consistent structured
// data on the page, (c) an unambiguous symbol, (d) the storefront's currency from the page URL's country TLD for a
// shared symbol or no marker, unless the page names another currency (`namedCurrencies`: a statement, a selector
// button, a priced code, a currency name or a currency select's chosen option) or its language points elsewhere.
// `lang` alone never decides.
import { DECIDING_MARKERS } from './amounts.ts';

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
 * Rule (b): a currency code from the page's structured data (JSON-LD, currency meta tags, microdata, currency
 * attributes such as `data-currency` or a component's `currency`). Null when there is none; `'conflict'` when they
 * disagree (a storefront serving several currencies), which blocks rule (d).
 */
export function structuredCurrency(doc: Document): string | 'conflict' | null {
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
      if (/currenc/i.test(name)) {
        const v = el.getAttribute(name) ?? '';
        if (/^[A-Za-z]{3}$/.test(v)) add(v);
      }
  }
  return found.size === 1 ? [...found][0]! : found.size > 1 ? 'conflict' : null;
}

const PREFIX_ALT = Object.keys(DECIDING_MARKERS)
  .filter((m) => m.endsWith('$'))
  .map((m) => m.replace('$', '\\$'))
  .join('|');
const PREFIX = `(${PREFIX_ALT})(?!\\p{L})`;
const CODE = '(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])';
const CODE_OR_PREFIX_RE = new RegExp(`${CODE}|${PREFIX}`, 'gu');
// A statement: a word, then a code or prefix with no number after it ("prices in USD", "shown in US$", "ALL PRICES
// IN AUD", "Currency: CAD"). The word is checked in code: a code itself ("USD AUD CAD") or a capitalised name
// without a colon ("Hong Kong SAR", "Canada $ USD") is a list or a place, not a statement; so is a code followed by
// another ("currency: USD AUD CAD").
const STATEMENT_RE = new RegExp(
  `(?<!\\p{L})(\\p{L}+)([\\s,]*:\\s*|[\\s,]+)(?:${CODE}|${PREFIX})(?!\\s*(?:\\d|[A-Z]{3}(?![A-Za-z])))`,
  'gu',
);
// A currency selector's button: "CAD $", "$ CAD", "Canada (CAD $)", "(USD)". Counts only when the visible text holds
// one such code; several are a list of choices.
const SELECTOR_RE = new RegExp(`${CODE}\\s?\\$(?!\\s?\\d)|\\$\\s?${CODE}|\\(${CODE}\\s?\\$?\\)`, 'gu');
// A price written with a code or country-named prefix ("CA$19.99", "$19.99 CAD", "CAD 19.99"). A conversion, after
// "≈" (also mangled), "~", "approx" or an opening parenthesis ("$19.72 (≈ AUD 11.50)"), is checked in code; a code
// after a capitalised word ("Hong Kong SAR $19.72", a place beside a price) or another code ("EUR CAD GBP 800-555-0100",
// a list beside a phone number) is not a prefix, nor is one before digits with a dash (a phone number or an ID).
const PRICED_RE = new RegExp(
  `(?<!\\p{Lu}\\p{Ll}+\\s)(?<![A-Z]{3}\\s)(?<![A-Za-z])(?<c1>[A-Z]{3})\\s?\\$?\\s?(?=\\d)(?!\\d+-)|(?<p>${PREFIX_ALT})\\s?(?=\\d)|\\d[\\d.,' ]*\\s?\\$?\\s?(?<![A-Za-z])(?<c2>[A-Z]{3})(?![A-Za-z])`,
  'gu',
);
/**
 * Currency names (matched on lower-cased text). "euro" alone can be a pillow size and "sterling" a silver, so they need
 * "in", a plural or "pounds".
 */
const NAMES: [RegExp, string][] = [
  [
    /(?:canadian|kanadische\w*|canadien|canadiense) dollars?|dollars? canadiens|d[óo]lares? canadienses/,
    'CAD',
  ],
  [/(?:us|u\.s\.|american|united states) dollars?|d[óo]lares? (?:americanos|estadounidenses)/, 'USD'],
  [/australian dollars?/, 'AUD'],
  [/new zealand dollars?/, 'NZD'],
  [/singapore dollars?/, 'SGD'],
  [/hong kong dollars?/, 'HKD'],
  [/(?:new )?taiwan dollars?/, 'TWD'],
  [/mexican pesos?|pesos? mexicanos?/, 'MXN'],
  [/\beuros\b|\bin euros?\b/, 'EUR'],
  [/pounds? sterling|british pounds?/, 'GBP'],
  [/japanese yen|\byen\b/, 'JPY'],
  [/chinese yuan|renminbi|\brmb\b/, 'CNY'],
  [/swiss francs?|schweizer franken|francs? suisses?/, 'CHF'],
  [/indian rupees?/, 'INR'],
  [/south african rand/, 'ZAR'],
  [/swedish kron\w*|svenska kronor/, 'SEK'],
  [/norwegian kron\w*|norske kroner/, 'NOK'],
  [/danish kron\w*|danske kroner/, 'DKK'],
  [/polish z[łl]oty/, 'PLN'],
  [/turkish lira|t[üu]rk liras[ıi]/, 'TRY'],
];

/** A `<select>`'s options, each with whether it is the selected one. */
export type SelectOptions = { text: string; selected: boolean }[];

/** Every currency a short text holds: codes, country-named prefixes and names (used on selector options). */
function currenciesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(CODE_OR_PREFIX_RE)) {
    const c = m[2] ? DECIDING_MARKERS[m[2]] : isCode(m[1]!) ? m[1] : null;
    if (c) out.add(c);
  }
  const lower = text.toLowerCase();
  for (const [re, c] of NAMES) if (re.test(lower)) out.add(c);
  return out;
}

/**
 * Currencies the page says its prices are in: a statement naming a code or country-named dollar, a selector button, a
 * price written with a code or such a prefix, a currency's name, or the chosen option of a currency `<select>` (one
 * whose options name two or more currencies). `text` is the text the shopper can see.
 */
export function namedCurrencies(text: string, selects: SelectOptions[] = []): Set<string> {
  const out = new Set<string>();
  const add = (code: string | undefined, prefix: string | undefined) => {
    const c = prefix ? DECIDING_MARKERS[prefix] : code && isCode(code) ? code : null;
    if (c) out.add(c);
  };
  for (const m of text.matchAll(STATEMENT_RE)) {
    const [, word, sep, code, prefix] = m;
    const statement =
      sep!.includes(':') || /^\p{Ll}/u.test(word!) || (/^\p{Lu}+$/u.test(word!) && !isCode(word!));
    if (statement) add(code, prefix);
  }
  const buttons = new Set<string>();
  for (const m of text.matchAll(SELECTOR_RE)) {
    const code = m.slice(1).find(Boolean)!;
    if (isCode(code)) buttons.add(code);
  }
  if (buttons.size === 1) out.add([...buttons][0]!);
  for (const m of text.matchAll(PRICED_RE)) {
    const { c1, p, c2 } = m.groups!;
    const before = text
      .slice(Math.max(0, m.index - 12), m.index)
      .split(')')
      .pop()!;
    if (!/[(≈~]|approx/i.test(before)) add(c1 ?? c2, p);
  }
  const lower = text.toLowerCase();
  for (const [re, c] of NAMES) if (re.test(lower)) out.add(c);
  for (const options of selects) {
    const all = new Set(options.flatMap((o) => [...currenciesIn(o.text)]));
    if (all.size < 2) continue;
    for (const o of options) if (o.selected) for (const c of currenciesIn(o.text)) out.add(c);
  }
  return out;
}

export type RowCurrencyEvidence = {
  /** Distinct ISO codes written in the row (rule (a)). */
  codes: string[];
  /** Deciding currency from a symbol in the row (rule (c)), `'shared'`, or null when there is no marker. */
  marker: string | null;
  /** The shared marker's text, when `marker === 'shared'`. */
  sharedText: string | null;
};

/**
 * Resolves the row's currency by the evidence order, or null when it is undetermined. `named` lists the currencies
 * the page's text names (codes, country-named prefixes); it is read only when rule (d) is reached.
 */
export function resolveCurrency(
  row: RowCurrencyEvidence,
  structured: string | 'conflict' | null,
  store: Storefront,
  named: () => Set<string>,
): string | null {
  if (row.codes.length > 1) return null;
  if (row.codes.length === 1) return row.codes[0]!;
  if (structured && structured !== 'conflict') return structured;
  if (row.marker && row.marker !== 'shared') return row.marker;
  // Rule (d): the storefront, only for a shared marker or no marker, and only when nothing on the page names
  // another currency.
  const storefront = (c: string | null) => (c && [...named()].every((n) => n === c) ? c : null);
  if (row.marker === 'shared') {
    const key = row.sharedText?.replace(/\.$/, '').replace('￥', '¥').replace('₨', 'Rs') ?? '';
    const options = SHARED_FOR[key] ?? [];
    if (store.tld) return options.includes(store.tld) ? storefront(store.tld) : null;
    // Generic TLD: a bare `$` is USD only on an English page with no other region.
    if (
      key === '$' &&
      (store.lang === '' || store.lang === 'en') &&
      (store.region === '' || store.region === 'us')
    )
      return storefront('USD');
    return null;
  }
  return storefront(store.tld);
}
