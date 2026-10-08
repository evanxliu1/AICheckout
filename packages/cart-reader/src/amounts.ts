// Amount grammar: locale number formats (decimal comma or dot; dot, comma, space or apostrophe grouping; Indian
// grouping; ",-" and ":-" zero decimals; non-Latin digits) with a currency marker before or after (ISO code,
// country-named dollar, symbol or local abbreviation). Nothing here names a store.

/** Markers that decide the currency on their own (protocol rule (a) codes and prefixes, rule (c) symbols). */
export const DECIDING_MARKERS: Record<string, string> = {
  US$: 'USD',
  CA$: 'CAD',
  C$: 'CAD',
  A$: 'AUD',
  AU$: 'AUD',
  NZ$: 'NZD',
  MX$: 'MXN',
  S$: 'SGD',
  HK$: 'HKD',
  NT$: 'TWD',
  R$: 'BRL',
  AR$: 'ARS',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '₩': 'KRW',
  '₺': 'TRY',
  zł: 'PLN',
  '₴': 'UAH',
  '₫': 'VND',
  '₦': 'NGN',
  '₪': 'ILS',
  '฿': 'THB',
  Kč: 'CZK',
  Ft: 'HUF',
  lei: 'RON',
  '₸': 'KZT',
  '৳': 'BDT',
  Rp: 'IDR',
  RM: 'MYR',
  'S/': 'PEN',
  'E£': 'EGP',
  LE: 'EGP',
  'L.E.': 'EGP',
  'ج.م': 'EGP',
  KSh: 'KES',
  'د.إ': 'AED',
  'ر.س': 'SAR',
  'Fr.': 'CHF',
  円: 'JPY',
  元: 'CNY',
  RMB: 'CNY',
  TL: 'TRY',
  원: 'KRW',
};
/** Markers several currencies share; the storefront decides (rule (d)). */
export const SHARED_MARKERS = ['$', '¥', '￥', 'kr', 'R', 'Rs', 'Rs.', '₨', '﷼'];

const WORD_MARK = /^[\p{L}./]+$/u;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const byLength = (a: string, b: string) => b.length - a.length;
const marks = [...Object.keys(DECIDING_MARKERS), ...SHARED_MARKERS].sort(byLength);
// Letter-only markers (LE, TL, kr, R, Rs, lei, Ft, ...) need letter boundaries; symbols do not.
const WORD_MARKS = marks
  .filter((m) => WORD_MARK.test(m))
  .map(esc)
  .join('|');
const SYM_MARKS = marks
  .filter((m) => !WORD_MARK.test(m))
  .map(esc)
  .join('|');
const MARK = `(?<![\\p{L}])(?:${WORD_MARKS})(?![\\p{L}])|(?:${SYM_MARKS})|(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])`;
const RUN = String.raw`\d(?:[\d.,' ]*\d)?(?:[.,:][-–—])?`;
const AMOUNT_RE = new RegExp(
  `(?<neg1>[-−–]\\s?)?(?<pre>${MARK})?\\s?(?<neg2>[-−–]\\s?)?(?<![\\d.,])(?<run>${RUN})(?!\\d|[.,]\\d|\\s?%)(?:\\s?(?<post>${MARK})(?!\\s?\\d))?`,
  'gu',
);
const CODE_RE = /^[A-Z]{3}$/;
/** Any currency marker or code at all: a cheap gate for text that may hold an amount. */
export const MARK_RE = new RegExp(MARK, 'u');

export type ParsedNumber = { int: string; frac: string };
export type Amount = {
  number: ParsedNumber | null;
  negative: boolean;
  /** An ISO 4217 code written with the amount, if any (validated by the caller). */
  code: string | null;
  /** A deciding currency from a symbol or local abbreviation, or `'shared'`, or null when there is no marker. */
  marker: string | null;
  /** The marker as written (for shared markers, which the storefront resolves). */
  markerText: string | null;
  start: number;
  end: number;
};

const DIGIT_RANGES = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0e50, 0xff10];
// Zero-width, bidi and word-joiner marks (built from a string so the source holds no such characters).
const INVISIBLE_RE = new RegExp('[\\u200b-\\u200f\\u202a-\\u202e\\u2060\\u2066-\\u2069\\ufeff\\u061c]', 'g');
/** Lower-cases nothing; maps non-Latin digits to ASCII, drops zero-width and bidi marks, normalizes spaces. */
export function normalizeText(s: string): string {
  let out = s.replace(INVISIBLE_RE, '');
  out = out.replace(/[٠-٩۰-۹०-९০-৯๐-๙０-９]/g, (ch) => {
    const c = ch.charCodeAt(0);
    const base = DIGIT_RANGES.find((b) => c >= b && c < b + 10) ?? c;
    return String(c - base);
  });
  return out
    .replace(/(\d)€(\d{2})(?!\d|[.,]\d)/g, '$1.$2 €')
    .replace(/[，]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses one numeric run into integer and fraction digit strings, or null when the format is not well formed. */
export function parseRun(run: string): ParsedNumber | null {
  let s = run;
  let zeroFrac = false;
  if (/[.,:][-–—]$/.test(s)) {
    s = s.slice(0, -2);
    zeroFrac = true;
  }
  const done = (int: string, frac: string) =>
    zeroFrac && frac ? null : { int: int.replace(/^0+(?=\d)/, ''), frac };
  if (/[ ']/.test(s)) {
    if (/ /.test(s) && /'/.test(s)) return null;
    const parts = s.split(/[ ']/);
    if (!/^\d{1,3}$/.test(parts[0]!)) return null;
    const last = parts.pop()!;
    if (!parts.slice(1).every((p) => /^\d{3}$/.test(p))) return null;
    const m = last.match(/^(\d{3})(?:[.,](\d{1,2}))?$/);
    if (!m) return null;
    return done(parts.join('') + m[1], m[2] ?? '');
  }
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots === 0 && commas === 0) return done(s, '');
  if (dots > 0 && commas > 0) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const grp = dec === '.' ? ',' : '.';
    const m = s.match(new RegExp(`^(\\d{1,3}(?:\\${grp}\\d{3})+)\\${dec}(\\d{1,2})$`));
    return m ? done(m[1]!.replace(new RegExp(`\\${grp}`, 'g'), ''), m[2]!) : null;
  }
  const sep = dots ? '.' : ',';
  const n = dots || commas;
  if (n > 1) {
    const grouped =
      new RegExp(`^\\d{1,3}(?:\\${sep}\\d{3})+$`).test(s) ||
      (sep === ',' && /^\d{1,2}(?:,\d{2})+,\d{3}$/.test(s));
    return grouped ? done(s.replace(new RegExp(`\\${sep}`, 'g'), ''), '') : null;
  }
  const [a, b] = s.split(sep) as [string, string];
  if (/^\d{1,3}$/.test(a) && /^\d{3}$/.test(b)) return done(a + b, '');
  if (/^\d{1,2}$/.test(b)) return done(a, b);
  return null;
}

/** Every amount-like token in a normalized text, with its marker. Bare numbers need two decimals. */
export function findAmounts(text: string, isCode: (c: string) => boolean): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const g = m.groups!;
    // A digit and a letter right before the run ("18Â 499,00": a mangled separator) make the number unreadable.
    const broken = /\d\p{L}{1,2} ?$/u.test(
      text.slice(0, m.index! + (g.neg1?.length ?? 0) + (g.pre?.length ?? 0)).replace(/[\s-−–]+$/, ''),
    );
    const parsed = broken ? null : parseRun(g.run!);
    let code: string | null = null;
    let marker: string | null = null;
    let markerText: string | null = null;
    for (const mk of [g.pre, g.post]) {
      if (!mk) continue;
      if (CODE_RE.test(mk) && !(mk in DECIDING_MARKERS)) {
        if (isCode(mk)) code ??= mk;
        continue;
      }
      if (marker) continue;
      marker = DECIDING_MARKERS[mk] ?? 'shared';
      markerText = mk;
    }
    if (!code && !marker && !(parsed && (parsed.frac.length === 2 || /[.,:][-–—]$/.test(g.run!)))) continue;
    out.push({
      number: parsed,
      negative: Boolean(g.neg1 || g.neg2),
      code,
      marker,
      markerText,
      start: m.index!,
      end: m.index! + m[0].length,
    });
  }
  return out;
}

/** Integer minor units for an exponent, or null when the fraction does not fit. */
export function toMinor(n: ParsedNumber, exponent: number): number | null {
  let frac = n.frac;
  if (frac.length > exponent) {
    if (!/^0*$/.test(frac.slice(exponent))) return null;
    frac = frac.slice(0, exponent);
  }
  const value = Number(n.int + frac.padEnd(exponent, '0'));
  return Number.isSafeInteger(value) ? value : null;
}
